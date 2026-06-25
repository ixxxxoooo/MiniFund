package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/datasource/sina"
	"minifund/internal/datasource/tencent"
	"minifund/internal/logger"
	"minifund/internal/model"
	"minifund/internal/scheduler"
	"minifund/internal/storage"
	"minifund/services"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// core 应用核心：装配存储、数据源、调度器与所有服务实例。
type core struct {
	Store        *storage.Store
	Scheduler    *scheduler.Scheduler
	SettingsSvc  *services.SettingsService
	FundSvc      *services.FundService
	WatchlistSvc *services.WatchlistService
	PortfolioSvc *services.PortfolioService
	MarketSvc    *services.MarketService
	WindowSvc    *services.WindowService
	NewsSvc      *services.NewsService
	AISvc        *services.AIService
	BackupSvc    *services.BackupService
	NotifySvc    *notifications.NotificationService

	// newsPayloads 缓存快讯通知 id → 新闻窗口 base64 载荷，供点击通知时复用打开弹窗
	newsMu       sync.Mutex
	newsPayloads map[string]string
}

// newCore 创建应用核心并装配服务（依赖 Wails 实例的部分延迟到 startup）。
func newCore() (*core, error) {
	logger.Info("正在创建应用实例...")

	store, err := storage.NewStore()
	if err != nil {
		return nil, err
	}

	settingsSvc := services.NewSettingsService(store)
	c := &core{
		Store:        store,
		SettingsSvc:  settingsSvc,
		FundSvc:      services.NewFundService(store),
		WatchlistSvc: services.NewWatchlistService(store),
		PortfolioSvc: services.NewPortfolioService(store),
		MarketSvc:    services.NewMarketService(store),
		WindowSvc:    services.NewWindowService(settingsSvc),
		NewsSvc:      services.NewNewsService(),
		AISvc:        services.NewAIService(settingsSvc),
		BackupSvc:    services.NewBackupService(store, settingsSvc),
		NotifySvc:    notifications.New(),
		newsPayloads: make(map[string]string),
	}
	logger.Info("所有服务实例创建完成")
	return c, nil
}

// startup 在 Wails 实例创建后完成调度器装配并启动后台任务。
func (c *core) startup(wailsApp *application.App) {
	// 指数行情：腾讯主源 + 新浪备源，降级状态广播给前端
	indexSrc := datasource.NewFallbackIndexSource(tencent.Source{}, sina.Source{}, func(source string, degraded bool) {
		if c.Scheduler != nil {
			c.Scheduler.EmitDegraded(source, degraded)
		}
	})
	c.Scheduler = scheduler.New(wailsApp, c.Store, indexSrc, c.SettingsSvc)

	// 服务与调度器互联
	c.WatchlistSvc.SetScheduler(c.Scheduler)
	c.PortfolioSvc.SetScheduler(c.Scheduler)
	c.PortfolioSvc.SetDetailProvider(c.FundSvc.GetFundDetail)
	c.MarketSvc.SetScheduler(c.Scheduler)
	// 行情中心指数由调度器每 30s 主动拉取并广播（封装 MarketService，避免包循环依赖）
	c.Scheduler.SetMarketCenterProvider(c.MarketSvc.GetMarketCenterQuotes)
	c.NewsSvc.SetScheduler(c.Scheduler)
	c.AISvc.SetApp(wailsApp)
	c.SettingsSvc.SetOnChange(c.Scheduler.RefreshNow)

	// 快讯桌面通知：调度器检测到新快讯时回调，封装 Wails 通知服务
	c.Scheduler.SetNewsNotifier(func(title, body string, item model.NewsFlash) {
		if c.NotifySvc == nil {
			return
		}
		// 预生成新闻窗口载荷（与前端 NewsPage.openNewsWindow 编码一致），
		// 缓存到 id，并随通知 Data 下发，便于点击通知时直接打开对应弹窗
		payload := buildNewsWindowPayload(item)
		c.newsMu.Lock()
		c.newsPayloads[item.ID] = payload
		// 容量上限兜底：常驻应用长期累积会内存泄漏，超限删除最早写入的一批。
		// （正常路径下，通知点击打开窗口后会立即删除对应 id，此处仅作兜底）
		if len(c.newsPayloads) > 200 {
			for k := range c.newsPayloads {
				delete(c.newsPayloads, k)
				if len(c.newsPayloads) <= 150 {
					break
				}
			}
		}
		c.newsMu.Unlock()
		if err := c.NotifySvc.SendNotification(notifications.NotificationOptions{
			ID: item.ID, Title: title, Body: body,
			Data: map[string]interface{}{"payload": payload},
		}); err != nil {
			logger.Warn("发送桌面通知失败: %v", err)
		}
	})
	// 定投到期桌面通知：调度器到期时回调，复用 Wails 通知服务
	c.Scheduler.SetDCANotifier(func(title, body string) {
		if c.NotifySvc == nil {
			return
		}
		if err := c.NotifySvc.SendNotification(notifications.NotificationOptions{
			ID: fmt.Sprintf("dca-%d", time.Now().UnixNano()), Title: title, Body: body,
		}); err != nil {
			logger.Warn("发送定投通知失败: %v", err)
		}
	})

	// 点击通知：打开对应的新闻详情弹窗（优先用 Data 载荷，回退到 id 缓存）
	c.NotifySvc.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error != nil {
			logger.Warn("处理通知响应失败: %v", result.Error)
			return
		}
		id := result.Response.ID
		payload, _ := result.Response.UserInfo["payload"].(string)
		if payload == "" {
			c.newsMu.Lock()
			payload = c.newsPayloads[id]
			c.newsMu.Unlock()
		} else {
			// 载荷直接来自通知 Data，map 里的缓存已无用，及时删除避免累积
			c.newsMu.Lock()
			delete(c.newsPayloads, id)
			c.newsMu.Unlock()
		}
		if id == "" || payload == "" {
			return
		}
		// 窗口操作需回主线程执行
		application.InvokeAsync(func() {
			if err := c.WindowSvc.OpenNewsWindow(id, payload); err != nil {
				logger.Warn("点击通知打开新闻窗口失败: %v", err)
				return
			}
			// 已成功打开窗口并使用 payload，删除缓存避免长期累积
			c.newsMu.Lock()
			delete(c.newsPayloads, id)
			c.newsMu.Unlock()
		})
	})
	// 启动时请求一次通知授权（macOS 需用户允许；失败不影响主流程）
	go func() {
		if ok, err := c.NotifySvc.RequestNotificationAuthorization(); err != nil {
			logger.Warn("请求通知授权失败: %v", err)
		} else if !ok {
			logger.Info("用户未授权桌面通知，快讯将不弹通知")
		}
	}()

	// 自选/持仓变更广播给所有窗口（主窗口与托盘面板保持同步）
	emitWatchlistChanged := func() {
		wailsApp.Event.Emit(scheduler.EventWatchlistChanged, nil)
	}
	c.WatchlistSvc.SetOnChange(emitWatchlistChanged)
	c.PortfolioSvc.SetOnChange(emitWatchlistChanged)
	// 数据导入后广播变更并触发一轮估值刷新，各窗口随即重载
	c.BackupSvc.SetOnChange(func() {
		c.Scheduler.RefreshNow()
		emitWatchlistChanged()
	})

	// 托盘面板显隐：联动调度器提速 + 广播事件（面板打开时前端重新加载数据）
	c.WindowSvc.SetTrayPanelVisibilityListener(func(visible bool) {
		c.Scheduler.SetFastMode(visible)
		if visible {
			wailsApp.Event.Emit(scheduler.EventTrayPanelShown, nil)
		}
	})

	// 基金代码表后台更新（过期检查），完成后启动调度循环
	go func() {
		c.FundSvc.EnsureFundIndex()
		c.Scheduler.Start()
		// 后台预热排行/主题/板块列表，进入对应页面秒开（失败不影响主流程）
		go c.FundSvc.PreloadRanking()
		go c.MarketSvc.PreloadMarket()
	}()
}

// services 返回需要注册给 Wails 的服务列表（暴露给前端 bindings）。
func (c *core) services() []application.Service {
	return []application.Service{
		application.NewService(c.SettingsSvc),
		application.NewService(c.FundSvc),
		application.NewService(c.WatchlistSvc),
		application.NewService(c.PortfolioSvc),
		application.NewService(c.MarketSvc),
		application.NewService(c.WindowSvc),
		application.NewService(c.NewsSvc),
		application.NewService(c.AISvc),
		application.NewService(c.BackupSvc),
		application.NewService(c.NotifySvc),
	}
}

// buildNewsWindowPayload 生成新闻详情窗口的 base64 载荷，编码方式与前端
// NewsPage.openNewsWindow 完全一致：base64(encodeURIComponent(JSON))，
// 以便复用 WindowService.OpenNewsWindow 与 NewsWindow 的解码逻辑。
func buildNewsWindowPayload(item model.NewsFlash) string {
	data := map[string]string{
		"kind":    "flash",
		"id":      item.ID,
		"title":   item.Title,
		"time":    item.Time,
		"url":     fmt.Sprintf("https://finance.eastmoney.com/a/%s.html", item.ID),
		"summary": item.Summary,
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString([]byte(encodeURIComponent(string(raw))))
}

// encodeURIComponent 复刻 JS encodeURIComponent 的转义规则：
// 不转义 A-Z a-z 0-9 以及 -_.!~*'( )，其余按 UTF-8 字节转为 %XX（大写十六进制）。
func encodeURIComponent(s string) string {
	const safe = "-_.!~*'()"
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || strings.IndexByte(safe, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0x0f])
	}
	return b.String()
}

// shutdown 应用关闭时的资源清理。
func (c *core) shutdown() {
	logger.Info("应用正在关闭...")
	if c.Scheduler != nil {
		c.Scheduler.Stop()
	}
	if c.Store != nil {
		c.Store.Close()
	}
	logger.Close()
}
