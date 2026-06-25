// Package scheduler 监控调度器：按交易时段状态机驱动估值/指数/净值确认轮询，
// 结果通过 Wails 事件广播给所有窗口。设计见 docs/TECH_DESIGN.md 第 4 节。
package scheduler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/datasource/eastmoney"
	"minifund/internal/datasource/tencent"
	"minifund/internal/logger"
	"minifund/internal/model"
	"minifund/internal/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// 事件名（前端在 lib/wails/events.ts 中订阅）
const (
	EventEstimates        = "fund:estimates"
	EventIndexes          = "market:indexes"
	EventNavConfirmed     = "fund:nav-confirmed"
	EventMonitorState     = "monitor:state"
	EventDegraded         = "datasource:degraded"
	EventWatchlistChanged = "watchlist:changed" // 自选/持仓变更（所有窗口需重新加载）
	EventTrayPanelShown   = "traypanel:shown"   // 托盘面板弹出（面板重新加载数据）
	EventNewsFlash        = "news:flash"        // 财经快讯刷新（推送最新快讯列表）
	EventMarketCenter     = "market:center"     // 行情中心指数刷新（每 30s 推送 A股/港股/美股/韩国清单）
)

// marketCenterInterval 行情中心指数主动刷新间隔（30s，独立于交易时段，
// 保证美股/韩国等盘外时段仍持续刷新）。
const marketCenterInterval = 30 * time.Second

// newsLastIDKey settings 表中记录最近一条已推送快讯 id 的键（重启后避免重复通知历史快讯）。
const newsLastIDKey = "news_last_id"

// navReconcileTTL 权威最新净值缓存有效期：最新净值每日仅变化一次，
// 节流后既能在收盘公布后数分钟内修正，又避免盘中每轮估值都重复请求历史净值。
const navReconcileTTL = 5 * time.Minute

// SettingsProvider 调度器需要的设置读取接口（由 SettingsService 实现，避免包循环依赖）。
type SettingsProvider interface {
	EstimateInterval() time.Duration // 盘中估值轮询间隔
	WatchedIndexes() []string        // 订阅的指数代码
	TrayTitleTarget() string         // 托盘标题展示目标（指数或基金代码，空为关闭）
	StealthMode() bool               // 摸鱼模式
	NewsPollInterval() time.Duration // 财经快讯定时拉取间隔
	NewsNotifyEnabled() bool         // 是否在收到新快讯时弹桌面通知
}

// Scheduler 监控调度器。
type Scheduler struct {
	app      *application.App
	store    *storage.Store
	indexSrc datasource.IndexQuoteSource
	settings SettingsProvider

	// setTrayTitle 托盘标题更新回调（由 app 装配时注入）
	setTrayTitle func(string)
	// newsNotify 桌面通知回调（由 app 装配时注入，封装 Wails 通知服务）；item 为触发通知的最新快讯
	newsNotify func(title, body string, item model.NewsFlash)
	// dcaNotify 定投到期桌面通知回调（由 app 装配时注入，封装 Wails 通知服务）
	dcaNotify func(title, body string)
	// marketCenterFn 行情中心指数拉取回调（由 app 装配注入 MarketService.GetMarketCenterQuotes，避免包循环依赖）
	marketCenterFn func() ([]model.MarketIndexQuote, error)

	mu            sync.Mutex
	paused        bool
	fastMode      bool // 托盘面板打开时提速到 15s
	lastEstimates []model.FundEstimate
	lastIndexes   []model.IndexQuote
	confirmed     map[string]bool // 当日已确认净值的基金
	confirmedDate string          // confirmed 对应的日期
	estimateDown  bool            // 估值源当前是否处于降级态（避免反复广播）

	// 权威最新净值缓存（用于校正 fundgz 滞后的估值，按 TTL + 自选集合变化节流刷新）
	latestNavs   map[string]model.NavRecord
	latestNavAt  time.Time
	latestNavKey string

	lastFlash   []model.NewsFlash // 最近一轮快讯缓存
	lastFlashID string            // 最近一条快讯 id（用于增量判断与持久化）
	newsInit    bool              // 是否已完成首轮快讯拉取（首轮不弹通知）
	newsBusy    bool              // 快讯拉取进行中（避免并发重入）

	marketCenterBusy bool // 行情中心拉取进行中（避免 30s 周期与首轮并发重入）

	refreshCh     chan struct{}
	newsRefreshCh chan struct{}
	stopCh        chan struct{}
	stopOnce      sync.Once
}

// New 创建调度器。
func New(app *application.App, store *storage.Store, indexSrc datasource.IndexQuoteSource, settings SettingsProvider) *Scheduler {
	return &Scheduler{
		app:           app,
		store:         store,
		indexSrc:      indexSrc,
		settings:      settings,
		confirmed:     make(map[string]bool),
		refreshCh:     make(chan struct{}, 1),
		newsRefreshCh: make(chan struct{}, 1),
		stopCh:        make(chan struct{}),
	}
}

// SetTrayTitleUpdater 注入托盘标题更新回调。
func (s *Scheduler) SetTrayTitleUpdater(fn func(string)) {
	s.setTrayTitle = fn
}

// SetNewsNotifier 注入桌面通知回调（装配时调用）。
func (s *Scheduler) SetNewsNotifier(fn func(title, body string, item model.NewsFlash)) {
	s.mu.Lock()
	s.newsNotify = fn
	s.mu.Unlock()
}

// SetDCANotifier 注入定投到期桌面通知回调（装配时调用）。
func (s *Scheduler) SetDCANotifier(fn func(title, body string)) {
	s.mu.Lock()
	s.dcaNotify = fn
	s.mu.Unlock()
}

// SetMarketCenterProvider 注入行情中心指数拉取回调（装配时调用，封装 MarketService）。
func (s *Scheduler) SetMarketCenterProvider(fn func() ([]model.MarketIndexQuote, error)) {
	s.mu.Lock()
	s.marketCenterFn = fn
	s.mu.Unlock()
}

// LastFlash 返回最近一轮快讯缓存（窗口初始化时拉取）。
func (s *Scheduler) LastFlash() []model.NewsFlash {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]model.NewsFlash, len(s.lastFlash))
	copy(out, s.lastFlash)
	return out
}

// RefreshNewsNow 立即触发一轮快讯拉取（手动刷新时调用，非阻塞）。
func (s *Scheduler) RefreshNewsNow() {
	select {
	case s.newsRefreshCh <- struct{}{}:
	default:
	}
}

// Start 启动调度循环（异步）。
func (s *Scheduler) Start() {
	go s.loop()
	logger.Info("监控调度器已启动")
}

// Stop 停止调度循环。
func (s *Scheduler) Stop() {
	s.stopOnce.Do(func() { close(s.stopCh) })
}

// Pause 暂停/恢复监控（托盘菜单调用）。
func (s *Scheduler) Pause(paused bool) {
	s.mu.Lock()
	s.paused = paused
	s.mu.Unlock()
	s.emitState()
	if !paused {
		s.RefreshNow()
	}
}

// IsPaused 返回是否处于暂停状态。
func (s *Scheduler) IsPaused() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.paused
}

// SetFastMode 托盘面板打开时提速估值轮询。
func (s *Scheduler) SetFastMode(fast bool) {
	s.mu.Lock()
	s.fastMode = fast
	s.mu.Unlock()
}

// RefreshNow 立即触发一轮拉取（自选变更/手动刷新时调用，非阻塞）。
func (s *Scheduler) RefreshNow() {
	select {
	case s.refreshCh <- struct{}{}:
	default:
	}
}

// LastEstimates 返回最近一轮估值缓存（窗口初始化时拉取）。
func (s *Scheduler) LastEstimates() []model.FundEstimate {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]model.FundEstimate, len(s.lastEstimates))
	copy(out, s.lastEstimates)
	return out
}

// LastIndexes 返回最近一轮指数行情缓存。
func (s *Scheduler) LastIndexes() []model.IndexQuote {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]model.IndexQuote, len(s.lastIndexes))
	copy(out, s.lastIndexes)
	return out
}

// CurrentState 返回当前监控状态。
func (s *Scheduler) CurrentState() model.MonitorState {
	now := time.Now()
	p := phaseAt(now)
	return model.MonitorState{
		Phase:      string(p),
		Paused:     s.IsPaused(),
		NextChange: nextChangeHint(p, now),
	}
}

// loop 调度主循环：每 2 秒评估一次任务到期情况。
func (s *Scheduler) loop() {
	// 启动时恢复最近一条已推送快讯 id（避免重启后把历史快讯当作新快讯通知）
	if id, err := s.store.GetSetting(newsLastIDKey); err == nil && id != "" {
		s.mu.Lock()
		s.lastFlashID = id
		s.mu.Unlock()
	}

	// 启动时无条件拉一轮（非交易时段 fundgz 也会返回最近数据，保证 UI 有初始内容）
	s.runEstimateRound()
	s.runIndexRound()
	s.runNewsRound()            // 首轮快讯：填充缓存并广播，但不弹通知
	go s.runMarketCenterRound() // 首轮行情中心（异步，避免阻塞启动）
	s.emitState()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var lastEstimate, lastIndex, lastNav time.Time
	lastNews := time.Now()
	lastMarketCenter := time.Now()
	lastPhase := phaseAt(time.Now())
	lastDCADate := "" // 定投到期检查按自然日去重

	for {
		select {
		case <-s.stopCh:
			return
		case <-s.refreshCh:
			s.runEstimateRound()
			s.runIndexRound()
		case <-s.newsRefreshCh:
			go s.runNewsRound()
		case now := <-ticker.C:
			// 快讯拉取独立于监控暂停与交易时段，按设置间隔定时拉取
			if now.Sub(lastNews) >= s.settings.NewsPollInterval() {
				lastNews = now
				go s.runNewsRound()
			}
			// 行情中心指数：独立于监控暂停与交易时段，每 30s 主动刷新
			// （美股盘在 CN 夜间、韩国盘在 CN 日间，需全天候刷新）。
			if now.Sub(lastMarketCenter) >= marketCenterInterval {
				lastMarketCenter = now
				go s.runMarketCenterRound()
			}
			// 定投到期检查：每自然日一次，独立于监控暂停与交易时段。
			if today := now.Format("2006-01-02"); today != lastDCADate {
				lastDCADate = today
				go s.runDCARound(today)
			}
			if s.IsPaused() {
				continue
			}
			phase := phaseAt(now)
			if phase != lastPhase {
				lastPhase = phase
				s.emitState()
				logger.Info("监控时段切换: %s", phase)
			}

			// 估值轮询：仅交易时段
			if phase == PhaseTrading && now.Sub(lastEstimate) >= s.estimateInterval() {
				lastEstimate = now
				s.runEstimateRound()
			}

			// 指数轮询：交易时段 10s，开盘前/午休/净值确认 60s
			indexInterval := time.Duration(0)
			switch phase {
			case PhaseTrading:
				indexInterval = 10 * time.Second
			case PhasePreMarket, PhaseLunch, PhaseNavConfirm:
				indexInterval = 60 * time.Second
			}
			if indexInterval > 0 && now.Sub(lastIndex) >= indexInterval {
				lastIndex = now
				s.runIndexRound()
			}

			// 净值确认：16:00-23:00 每 10 分钟
			if phase == PhaseNavConfirm && now.Sub(lastNav) >= 10*time.Minute {
				lastNav = now
				s.runNavConfirmRound()
			}
		}
	}
}

// estimateInterval 当前生效的估值轮询间隔。
func (s *Scheduler) estimateInterval() time.Duration {
	s.mu.Lock()
	fast := s.fastMode
	s.mu.Unlock()
	if fast {
		return 15 * time.Second
	}
	return s.settings.EstimateInterval()
}

// isExchangeTraded 判断基金类型是否为场内交易（ETF/场内 LOF），场内基金走交易所实时行情。
// ETF 联接基金类型为"指数型-股票"，不会误判。
func isExchangeTraded(fundType string) bool {
	return strings.Contains(fundType, "场内") || strings.Contains(fundType, "ETF")
}

// runEstimateRound 拉取一轮自选基金估值并广播。
// 场外基金走东财估值接口；场内 ETF/LOF 走腾讯交易所实时行情。
func (s *Scheduler) runEstimateRound() {
	codes, err := s.store.AllWatchedCodes()
	if err != nil {
		logger.Warn("读取自选代码失败: %v", err)
		return
	}
	if len(codes) == 0 {
		s.mu.Lock()
		s.lastEstimates = nil
		s.mu.Unlock()
		s.app.Event.Emit(EventEstimates, []model.FundEstimate{})
		return
	}

	types, err := s.store.FundTypes(codes)
	if err != nil {
		logger.Warn("查询基金类型失败: %v", err)
		types = map[string]string{}
	}
	var otc, exchange []string
	for _, c := range codes {
		if isExchangeTraded(types[c]) {
			exchange = append(exchange, c)
		} else {
			otc = append(otc, c)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	estimates := make([]model.FundEstimate, 0, len(codes))
	if len(otc) > 0 {
		if est, err := eastmoney.FetchEstimates(ctx, otc); err == nil {
			estimates = append(estimates, est...)
		} else {
			logger.Warn("估值轮询失败: %v", err)
		}
	}
	if len(exchange) > 0 {
		if est, err := tencent.FetchFundQuotes(ctx, exchange); err == nil {
			estimates = append(estimates, est...)
		} else {
			logger.Warn("场内行情轮询失败: %v", err)
		}
	}
	// 自选非空却拉不到任何估值：估值源整体不可用，广播降级提示（前端展示「数据延迟」徽标）。
	// 连续多轮失败时只在首次广播（estimateDown 去抖），恢复时再广播一次。
	if len(estimates) == 0 {
		if !s.estimateDown {
			s.estimateDown = true
			s.EmitDegraded("estimate", true)
		}
		return
	}
	if s.estimateDown {
		s.estimateDown = false
		s.EmitDegraded("estimate", false)
	}
	// 用权威历史净值校正场外基金估值（fundgz 在净值公布后会滞后）。
	if len(otc) > 0 {
		s.reconcileEstimates(ctx, estimates, otc)
	}
	s.mu.Lock()
	s.lastEstimates = estimates
	s.mu.Unlock()
	s.app.Event.Emit(EventEstimates, estimates)
	s.updateTrayTitle()
}

// reconcileEstimates 以权威历史净值（与详情页同源）校正 fundgz 估值：
//   - 「最新净值」始终取历史净值最新一条（fundgz 的 dwjz 在净值公布后会滞后一个交易日）；
//   - 当盘中估算对应的交易日（估值时间 gztime 的日期）已被确认时，该估算已过期，清除之，
//     避免自选列表显示与详情页对不上的陈旧估值/估算涨跌。
//
// 盘中（估算交易日尚未确认）则保留 fundgz 的实时估算。
func (s *Scheduler) reconcileEstimates(ctx context.Context, estimates []model.FundEstimate, otc []string) {
	navs := s.latestNavCache(ctx, otc)
	if len(navs) == 0 {
		return
	}
	// 批量查询基金类型，QDII 基金的 fundgz 估算与历史净值日期因海外时差本就不同步，
	// 用「估算交易日 ≤ 已确认净值日期」判定会误清当前交易日有效的估算，故 QDII 跳过清除逻辑。
	types, _ := s.store.FundTypes(otc)
	isQDII := func(code string) bool {
		t, ok := types[code]
		return ok && strings.Contains(t, "QDII")
	}
	for i := range estimates {
		e := &estimates[i]
		rec, ok := navs[e.Code]
		if !ok || rec.Date == "" {
			continue
		}
		// 以历史净值最新一条作为权威「最新净值」
		e.PrevNav = rec.Nav
		e.NavDate = rec.Date
		// 记录已公布日涨幅（与排行 rzdf 同源），作为盘后/非交易日「今日涨幅」兜底
		e.DayGrowth = rec.Growth
		e.HasDayGrowth = true
		// 估算目标交易日 = 估值时间 gztime 的日期（形如 "2026-06-12 15:00"）。
		// 该日 ≤ 最新已确认净值日期时，估算已被实际净值取代，应清除。
		target := ""
		if len(e.EstimateTime) >= 10 {
			target = e.EstimateTime[:10]
		}
		// QDII 基金跳过清除：其历史净值与估算日期因海外时差不同步，清除会误删当前有效估算。
		if !isQDII(e.Code) && e.HasEstimate && target != "" && rec.Date >= target {
			e.HasEstimate = false
			e.Estimate = 0
			e.EstimateGrowth = 0
		}
	}
}

// latestNavCache 返回自选场外基金的权威最新净值（按 TTL + 自选集合变化节流刷新）。
func (s *Scheduler) latestNavCache(ctx context.Context, codes []string) map[string]model.NavRecord {
	sorted := append([]string(nil), codes...)
	sort.Strings(sorted)
	key := strings.Join(sorted, ",")

	s.mu.Lock()
	if s.latestNavs != nil && s.latestNavKey == key && time.Since(s.latestNavAt) < navReconcileTTL {
		out := make(map[string]model.NavRecord, len(s.latestNavs))
		for k, v := range s.latestNavs {
			out[k] = v
		}
		s.mu.Unlock()
		return out
	}
	s.mu.Unlock()

	navs := eastmoney.FetchLatestNavs(ctx, codes)
	if len(navs) > 0 {
		s.mu.Lock()
		s.latestNavs = navs
		s.latestNavAt = time.Now()
		s.latestNavKey = key
		s.mu.Unlock()
	}
	return navs
}

// runIndexRound 拉取一轮指数行情并广播。
func (s *Scheduler) runIndexRound() {
	symbols := s.settings.WatchedIndexes()
	if len(symbols) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	quotes, err := s.indexSrc.FetchIndexQuotes(ctx, symbols)
	if err != nil {
		logger.Warn("指数轮询失败: %v", err)
		return
	}
	s.mu.Lock()
	s.lastIndexes = quotes
	s.mu.Unlock()
	s.app.Event.Emit(EventIndexes, quotes)
	s.updateTrayTitle()
}

// runMarketCenterRound 拉取一轮行情中心指数清单并广播（payload 直接下发，前端免再调 binding）。
// 通过注入的回调拉取（封装 MarketService.GetMarketCenterQuotes，含 5s 缓存合并并发请求）。
func (s *Scheduler) runMarketCenterRound() {
	s.mu.Lock()
	fn := s.marketCenterFn
	busy := s.marketCenterBusy
	if fn == nil || busy {
		s.mu.Unlock()
		return
	}
	s.marketCenterBusy = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.marketCenterBusy = false
		s.mu.Unlock()
	}()

	quotes, err := fn()
	if err != nil {
		logger.Warn("行情中心指数轮询失败: %v", err)
		return
	}
	if len(quotes) == 0 {
		return
	}
	s.app.Event.Emit(EventMarketCenter, quotes)
}

// runNavConfirmRound 净值确认：逐只查询当日真实净值，确认后落库收益并广播。
func (s *Scheduler) runNavConfirmRound() {
	// 节假日（含日历过期退化的非交易日）当日净值不会公布，整轮跳过，避免无效请求循环。
	if !IsTradingDay(time.Now()) {
		return
	}
	today := time.Now().Format("2006-01-02")
	s.mu.Lock()
	if s.confirmedDate != today {
		s.confirmed = make(map[string]bool)
		s.confirmedDate = today
	}
	s.mu.Unlock()

	codes, err := s.store.AllWatchedCodes()
	if err != nil {
		logger.Warn("读取自选代码失败: %v", err)
		return
	}
	// 本轮已尝试过但落库失败的基金，本轮内不再重复请求历史净值，
	// 避免 DB 持续故障（如锁超时）时反复打到东财。下一轮（10 分钟后）仍会重试。
	skipped := make(map[string]bool, len(codes))
	for _, code := range codes {
		s.mu.Lock()
		done := s.confirmed[code]
		s.mu.Unlock()
		if done {
			continue
		}
		if skipped[code] {
			continue
		}
		// 已落库的也跳过（应用重启后恢复状态）
		if ok, _ := s.store.HasDailyProfit(code, today); ok {
			s.mu.Lock()
			s.confirmed[code] = true
			s.mu.Unlock()
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		page, err := eastmoney.FetchNavHistory(ctx, code, 1, 2)
		cancel()
		if err != nil || len(page.Items) == 0 {
			continue
		}
		latest := page.Items[0]
		if latest.Date != today {
			continue // 当日净值尚未公布
		}

		// 计算当日真实收益（有持仓时）：与单日涨幅 latest.Growth 同源，
		// 避免用历史第二根净值在周末/长假后变成「多日累计涨跌」而高估当日收益。
		// 收益 ≈ 昨日市值 × 涨幅 = (份额 × 今日净值) × 涨幅 / (1 + 涨幅)，
		// 简化为 份额 × 今日净值 × 涨幅 / 100（涨幅已为百分比，误差可忽略，与 daily_profit 口径一致）。
		var profit float64
		if pos, _ := s.store.GetPosition(code); pos != nil {
			profit = pos.Shares * latest.Nav * latest.Growth / 100
		}
		if err := s.store.SaveDailyProfit(code, today, latest.Nav, latest.Growth, profit); err != nil {
			logger.Warn("净值确认落库失败: code=%s err=%v", code, err)
			skipped[code] = true // 本轮跳过，避免反复打接口；下一轮仍会重试
			continue
		}
		s.mu.Lock()
		s.confirmed[code] = true
		// 更新估值缓存中的 prevNav 和 navDate，使前端表格显示最新净值；
		// 当日净值既已确认，盘中估算已被实际净值取代，清除之避免显示陈旧估算。
		for i := range s.lastEstimates {
			if s.lastEstimates[i].Code == code {
				s.lastEstimates[i].PrevNav = latest.Nav
				s.lastEstimates[i].NavDate = latest.Date
				s.lastEstimates[i].HasEstimate = false
				s.lastEstimates[i].Estimate = 0
				s.lastEstimates[i].EstimateGrowth = 0
				s.lastEstimates[i].DayGrowth = latest.Growth
				s.lastEstimates[i].HasDayGrowth = true
				break
			}
		}
		// 同步刷新权威最新净值缓存，使下一轮估值校正立即反映已确认净值。
		if s.latestNavs != nil {
			s.latestNavs[code] = model.NavRecord{Date: latest.Date, Nav: latest.Nav, AccNav: latest.AccNav, Growth: latest.Growth}
		}
		s.mu.Unlock()
		s.app.Event.Emit(EventNavConfirmed, model.NavConfirmed{
			Code: code, Date: latest.Date, Nav: latest.Nav, Growth: latest.Growth, Profit: profit,
		})
		// 同步广播更新后的估值列表，让前端表格净值列立即刷新
		s.mu.Lock()
		out := make([]model.FundEstimate, len(s.lastEstimates))
		copy(out, s.lastEstimates)
		s.mu.Unlock()
		s.app.Event.Emit(EventEstimates, out)
		logger.Info("当日净值已确认: code=%s nav=%.4f growth=%.2f%%", code, latest.Nav, latest.Growth)
	}
}

// runDCARound 定投到期处理：到期计划按需自动入账（金额÷最新净值估算份额），
// 并发桌面通知提醒，随后推进计划到下一周期。
func (s *Scheduler) runDCARound(today string) {
	plans, err := s.store.DueDCAPlans(today)
	if err != nil {
		logger.Warn("查询到期定投计划失败: %v", err)
		return
	}
	if len(plans) == 0 {
		return
	}

	s.mu.Lock()
	notify := s.dcaNotify
	s.mu.Unlock()

	changed := false
	for _, p := range plans {
		name := p.Code
		if rec, _ := s.store.GetFundIndexItem(p.Code); rec != nil && rec.Name != "" {
			name = rec.Name
		}

		recorded := false
		if p.AutoRecord {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			navs := eastmoney.FetchLatestNavs(ctx, []string{p.Code})
			cancel()
			rec, ok := navs[p.Code]
			if ok && rec.Nav > 0 {
				shares := p.Amount / rec.Nav
				txn := model.PositionTxn{
					Code: p.Code, Date: today, Kind: model.TxnKindBuy,
					Shares: shares, Price: rec.Nav, Amount: p.Amount,
					Source: model.TxnSourceDCA, Note: "定投自动入账",
				}
				// 入账与推进合并为单事务：任一失败整体回滚，杜绝入账成功但推进失败导致次日重复买入。
				next := storage.NextRunDate(p.Freq, p.Day, today)
				if err := s.store.RecordDCA(txn, p.ID, next); err != nil {
					logger.Warn("定投自动入账失败: code=%s err=%v", p.Code, err)
				} else {
					recorded = true
					changed = true
				}
			} else {
				logger.Warn("定投自动入账取净值失败: code=%s", p.Code)
			}
		}

		if notify != nil {
			body := fmt.Sprintf("%s 定投 %.2f 元到期，请手动记一笔", name, p.Amount)
			if recorded {
				body = fmt.Sprintf("已为 %s 自动定投买入 %.2f 元", name, p.Amount)
			}
			notify("定投提醒", body)
		}

		// 非自动入账（仅提醒）的计划单独推进；自动入账已在 RecordDCA 事务内一并推进。
		if !p.AutoRecord {
			if err := s.store.AdvanceDCAPlan(p.ID, p.Freq, p.Day, today); err != nil {
				logger.Warn("推进定投计划失败: id=%d err=%v", p.ID, err)
			}
		}
	}

	// 有自动入账或计划状态变化时广播，让各窗口重载持仓/计划
	s.app.Event.Emit(EventWatchlistChanged, nil)
	if changed {
		s.RefreshNow()
	}
	logger.Info("定投到期处理完成: 共 %d 个计划", len(plans))
}

// runNewsRound 拉取一轮财经快讯：广播最新列表，并对新增条目按设置弹桌面通知。
func (s *Scheduler) runNewsRound() {
	// 避免并发重入（定时与手动刷新可能叠加）
	s.mu.Lock()
	if s.newsBusy {
		s.mu.Unlock()
		return
	}
	s.newsBusy = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.newsBusy = false
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	list, err := eastmoney.FetchFlashNews(ctx, 50)
	if err != nil {
		logger.Warn("快讯轮询失败: %v", err)
		return
	}
	if len(list) == 0 {
		return
	}

	s.mu.Lock()
	prevID := s.lastFlashID
	firstRun := !s.newsInit
	s.newsInit = true
	// list 按时间倒序，遇到上次最新 id 即停止，之前的均为新增。
	// 游标失效保护：若 prevID 已被挤出列表（低峰期条目变少/重排/重启后过期），
	// 循环不会 break，此时不应把整页都当新增弹通知，仅广播列表并更新游标。
	var fresh []model.NewsFlash
	hit := false
	if prevID != "" {
		for _, n := range list {
			if n.ID == prevID {
				hit = true
				break
			}
			fresh = append(fresh, n)
		}
	}
	s.lastFlash = list
	s.lastFlashID = list[0].ID
	notify := s.newsNotify
	s.mu.Unlock()

	// 广播最新快讯列表（所有窗口整体更新）
	s.app.Event.Emit(EventNewsFlash, list)
	// 持久化最新 id
	if err := s.store.SetSetting(newsLastIDKey, list[0].ID); err != nil {
		logger.Warn("持久化快讯游标失败: %v", err)
	}

	// 桌面通知：仅在非首轮、游标确实命中（避免误把整页当新增）、存在新增、通知开启且回调就绪时
	if !firstRun && hit && len(fresh) > 0 && notify != nil && s.settings.NewsNotifyEnabled() {
		latest := fresh[0]
		body := latest.Title
		if len(fresh) > 1 {
			body = fmt.Sprintf("%s（等 %d 条新快讯）", latest.Title, len(fresh))
		}
		notify("财经快讯", body, latest)
		logger.Info("推送快讯通知: 新增 %d 条", len(fresh))
	}
}

// emitState 广播监控状态。
func (s *Scheduler) emitState() {
	s.app.Event.Emit(EventMonitorState, s.CurrentState())
}

// EmitDegraded 广播数据源降级状态（由 FallbackIndexSource 回调触发）。
func (s *Scheduler) EmitDegraded(source string, degraded bool) {
	s.app.Event.Emit(EventDegraded, map[string]any{"source": source, "degraded": degraded})
}

// updateTrayTitle 按设置目标刷新托盘标题。
func (s *Scheduler) updateTrayTitle() {
	if s.setTrayTitle == nil {
		return
	}
	target := s.settings.TrayTitleTarget()
	if target == "" {
		s.setTrayTitle("")
		return
	}
	stealth := s.settings.StealthMode()

	s.mu.Lock()
	defer s.mu.Unlock()
	// 先在指数中找，再在自选估值中找
	for _, q := range s.lastIndexes {
		if q.Symbol == target {
			s.setTrayTitle(formatTrayTitle(q.ChangePercent, stealth))
			return
		}
	}
	for _, e := range s.lastEstimates {
		if e.Code == target && e.HasEstimate {
			s.setTrayTitle(formatTrayTitle(e.EstimateGrowth, stealth))
			return
		}
	}
}

// formatTrayTitle 生成托盘标题文本（如 ▲1.24%）；摸鱼模式输出中性格式（无方向符号）。
func formatTrayTitle(percent float64, stealth bool) string {
	if stealth {
		return fmt.Sprintf("%.2f%%", abs(percent))
	}
	switch {
	case percent > 0:
		return fmt.Sprintf("▲%.2f%%", percent)
	case percent < 0:
		return fmt.Sprintf("▼%.2f%%", -percent)
	default:
		return "0.00%"
	}
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
