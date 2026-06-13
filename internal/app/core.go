package app

import (
	"minifund/internal/datasource"
	"minifund/internal/datasource/sina"
	"minifund/internal/datasource/tencent"
	"minifund/internal/logger"
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
	NotifySvc    *notifications.NotificationService
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
		MarketSvc:    services.NewMarketService(),
		WindowSvc:    services.NewWindowService(settingsSvc),
		NewsSvc:      services.NewNewsService(),
		AISvc:        services.NewAIService(settingsSvc),
		NotifySvc:    notifications.New(),
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
	c.NewsSvc.SetScheduler(c.Scheduler)
	c.AISvc.SetApp(wailsApp)
	c.SettingsSvc.SetOnChange(c.Scheduler.RefreshNow)

	// 快讯桌面通知：调度器检测到新快讯时回调，封装 Wails 通知服务
	c.Scheduler.SetNewsNotifier(func(title, body, id string) {
		if c.NotifySvc == nil {
			return
		}
		if err := c.NotifySvc.SendNotification(notifications.NotificationOptions{
			ID: id, Title: title, Body: body,
		}); err != nil {
			logger.Warn("发送桌面通知失败: %v", err)
		}
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
		application.NewService(c.NotifySvc),
	}
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
