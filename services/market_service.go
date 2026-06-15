package services

import (
	"context"
	"fmt"
	"sort"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/datasource/sina"
	"minifund/internal/datasource/tencent"
	"minifund/internal/model"
	"minifund/internal/scheduler"
	"minifund/internal/storage"
)

// K 线动态加载与缓存边界：单次最多 1000 根（数据源上限），初始预加载 500 根。
const (
	klineMaxLimit     = 1000
	klineDefaultLimit = 500
	klineMinLimit     = 60
)

// 板块/主题列表内存缓存时效（页面可见才请求，60s 足够新鲜并大幅提速）。
const marketCacheTTL = 60 * time.Second

// 行情中心指数实时报价缓存时效：偏短以保证盘中刷新及时，又能合并多窗口/多次事件触发的重复请求。
const indexQuoteCacheTTL = 5 * time.Second

// klinePeriods 行情中心 K 线周期键 → 东财 klt 编码。
var klinePeriods = map[string]int{
	"day":   101, // 日 K
	"week":  102, // 周 K
	"month": 103, // 月 K
}

// MarketService 市场行情服务：指数、板块、监控状态控制。
type MarketService struct {
	sched      *scheduler.Scheduler
	store      *storage.Store
	cache      *ttlCache
	quoteCache *ttlCache
}

// NewMarketService 创建市场行情服务（store 用于 K 线长期缓存与离线兜底）。
func NewMarketService(store *storage.Store) *MarketService {
	return &MarketService{
		store:      store,
		cache:      newTTLCache(marketCacheTTL),
		quoteCache: newTTLCache(indexQuoteCacheTTL),
	}
}

// SetScheduler 注入调度器（装配时调用，不暴露给前端使用）。
func (s *MarketService) SetScheduler(sched *scheduler.Scheduler) {
	s.sched = sched
}

// GetIndexQuotes 返回最近一轮指数行情缓存（窗口初始化用，后续靠事件推送）。
func (s *MarketService) GetIndexQuotes() ([]model.IndexQuote, error) {
	if s.sched == nil {
		return []model.IndexQuote{}, nil
	}
	return s.sched.LastIndexes(), nil
}

// GetEstimates 返回最近一轮自选估值缓存（窗口初始化用，后续靠事件推送）。
func (s *MarketService) GetEstimates() ([]model.FundEstimate, error) {
	if s.sched == nil {
		return []model.FundEstimate{}, nil
	}
	return s.sched.LastEstimates(), nil
}

// GetSectors 拉取板块行情（60s 内存缓存）。kind：industry（行业）/ concept（概念）。
func (s *MarketService) GetSectors(kind string) ([]model.SectorItem, error) {
	key := "sectors|" + kind
	if v, ok := s.cache.get(key); ok {
		return v.([]model.SectorItem), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	list, err := eastmoney.FetchSectors(ctx, kind)
	if err != nil {
		return nil, err
	}
	s.cache.set(key, list)
	return list, nil
}

// GetSectorMoneyFlow 拉取热门主题「按资金流入」排行（按所选周期主力净流入，60s 内存缓存）。
// kind：all / industry / concept；stage：now 实时 / week 近1周 / month 近1月 / m3 近3月。
// 与「按涨幅」同为 ztjj 主题体系（BK000xxx），点击可进入主题相关基金。
func (s *MarketService) GetSectorMoneyFlow(kind, stage string) ([]model.SectorItem, error) {
	key := "sectorflow|" + kind + "|" + stage
	if v, ok := s.cache.get(key); ok {
		return v.([]model.SectorItem), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	list, err := eastmoney.FetchSectorMoneyFlow(ctx, kind, stage)
	if err != nil {
		return nil, err
	}
	s.cache.set(key, list)
	return list, nil
}

// GetMarketCenterQuotes 拉取行情中心指数清单实时报价（5s 内存缓存，合并多窗口/多次事件触发的重复请求）。
// 主源腾讯（稳定，A股/港股/美股全覆盖），失败回退东财 ulist.np。
func (s *MarketService) GetMarketCenterQuotes() ([]model.MarketIndexQuote, error) {
	if v, ok := s.quoteCache.get("center-quotes"); ok {
		return v.([]model.MarketIndexQuote), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	syms := make([]string, 0, len(eastmoney.MarketCenterIndexes))
	for _, m := range eastmoney.MarketCenterIndexes {
		// 跳过无腾讯符号的指数（如韩国 KOSPI），其实时报价稍后由东财补全。
		if m.Tencent != "" {
			syms = append(syms, m.Tencent)
		}
	}
	quotes, err := tencent.Source{}.FetchIndexQuotes(ctx, syms)
	if err != nil {
		// 腾讯失败时回退东财，仍失败才向上报错。
		list, eerr := eastmoney.FetchMarketCenterQuotes(ctx)
		if eerr != nil {
			return nil, err
		}
		s.quoteCache.set("center-quotes", list)
		return list, nil
	}

	bySym := make(map[string]model.IndexQuote, len(quotes))
	for _, q := range quotes {
		bySym[q.Symbol] = q
	}
	// 按清单顺序输出，保证分组展示稳定；缺失项占位展示名称。
	out := make([]model.MarketIndexQuote, 0, len(eastmoney.MarketCenterIndexes))
	for _, m := range eastmoney.MarketCenterIndexes {
		mq := model.MarketIndexQuote{Secid: m.Secid, Name: m.Name, Group: m.Group}
		if q, ok := bySym[m.Tencent]; ok && m.Tencent != "" {
			mq.Price = q.Price
			mq.Change = q.Change
			mq.ChangePercent = q.ChangePercent
			mq.Amount = q.Amount // 成交额（本币基础单位，按市场展示币种，不做汇率换算）
		}
		out = append(out, mq)
	}

	// 腾讯无符号的指数（如韩国 KOSPI）改用东财单标的接口 stock/get 补全实时报价。
	// 海外指数批量 ulist.np 常返回缺失/异常，单标的接口更稳定；失败则保留占位（不影响其他指数）。
	for i := range out {
		meta, ok := eastmoney.FindIndexBySecid(out[i].Secid)
		if !ok || meta.Tencent != "" {
			continue
		}
		if q, ferr := eastmoney.FetchIndexQuoteSingle(ctx, out[i].Secid); ferr == nil && q.Price > 0 {
			out[i].Price = q.Price
			out[i].Change = q.Change
			out[i].ChangePercent = q.ChangePercent
			out[i].Amount = q.Amount
		}
	}

	s.quoteCache.set("center-quotes", out)
	return out, nil
}

// GetIndexKline 按指数 secid 与周期（day/week/month）拉取 K 线。
// limit 为请求的最近 K 线根数（钳制到 [60,1000]），前端缩放/向左滚动时逐步增大以动态加载更多历史。
// 取源成功后与 SQLite 长期缓存按日期并集合并落库（上限 1000 根），取源失败则回退缓存（离线兜底）。
// 主源腾讯（A股/港股可取完整历史）；美股/北证 50 走新浪；韩国 KOSPI 等回退东财 push2his。
func (s *MarketService) GetIndexKline(secid, period string, limit int) ([]model.Kline, error) {
	klt, ok := klinePeriods[period]
	if !ok {
		klt = klinePeriods["day"]
		period = "day"
	}
	if limit <= 0 {
		limit = klineDefaultLimit
	}
	if limit < klineMinLimit {
		limit = klineMinLimit
	}
	if limit > klineMaxLimit {
		limit = klineMaxLimit
	}

	key := fmt.Sprintf("kline|%s|%s|%d", secid, period, limit)
	if v, ok := s.cache.get(key); ok {
		return v.([]model.Kline), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	meta, _ := eastmoney.FindIndexBySecid(secid)

	// 按来源路由：腾讯（A股主要/港股）/ 新浪 A 股（北证 50）/ 新浪美股（道指等）。
	var list []model.Kline
	switch meta.KSource {
	case eastmoney.KSourceSinaCN:
		if kl, err := (sina.Source{}).FetchCNIndexKline(ctx, meta.Sina, period, limit); err == nil && len(kl) >= 2 {
			list = kl
		}
	case eastmoney.KSourceSinaUS:
		if kl, err := (sina.Source{}).FetchUSIndexKline(ctx, meta.Sina, period, limit); err == nil && len(kl) >= 2 {
			list = kl
		}
	case eastmoney.KSourceEastmoney:
		// 韩国 KOSPI 等无腾讯/新浪源的指数：直接走下方东财 push2his 兜底。
	default:
		if meta.Tencent != "" {
			if kl, err := (tencent.Source{}).FetchIndexKline(ctx, meta.Tencent, period, limit); err == nil && len(kl) >= 2 {
				list = kl
			}
		}
	}
	// 主源不足两根时回退东财 push2his（多数情况下被反爬，仅作最后兜底）。
	if len(list) < 2 {
		if kl, err := eastmoney.FetchIndexKline(ctx, secid, klt, limit); err == nil && len(kl) >= 2 {
			list = kl
		}
	}

	if len(list) < 2 {
		// 取源失败：回退 SQLite 长期缓存（离线"随时拉出来"）。
		if s.store != nil {
			if cached, err := s.store.GetKlineCache(secid, period); err == nil && len(cached) >= 2 {
				return tailKlines(cached, limit), nil
			}
		}
		return nil, fmt.Errorf("该指数历史 K 线暂不可用（数据源限制），请稍后重试")
	}

	// 与长期缓存按日期并集合并（保留更长历史），落库后返回最近 limit 根。
	merged := list
	if s.store != nil {
		if cached, err := s.store.GetKlineCache(secid, period); err == nil && len(cached) > 0 {
			merged = mergeKlines(cached, list)
		}
		_ = s.store.SaveKlineCache(secid, period, merged)
	}
	out := tailKlines(merged, limit)
	s.cache.set(key, out)
	return out, nil
}

// mergeKlines 将两段 K 线按日期并集合并（升序），同日期以 newer 覆盖 older（最新一根盘中会变动），上限 1000 根。
func mergeKlines(older, newer []model.Kline) []model.Kline {
	byDate := make(map[string]model.Kline, len(older)+len(newer))
	dates := make([]string, 0, len(older)+len(newer))
	add := func(k model.Kline) {
		if _, ok := byDate[k.Date]; !ok {
			dates = append(dates, k.Date)
		}
		byDate[k.Date] = k
	}
	for _, k := range older {
		add(k)
	}
	for _, k := range newer {
		add(k)
	}
	sort.Strings(dates)
	out := make([]model.Kline, 0, len(dates))
	for _, d := range dates {
		out = append(out, byDate[d])
	}
	return tailKlines(out, klineMaxLimit)
}

// tailKlines 返回末尾（最近）limit 根；不足则原样返回。
func tailKlines(list []model.Kline, limit int) []model.Kline {
	if limit <= 0 || len(list) <= limit {
		return list
	}
	return list[len(list)-limit:]
}

// GetMarketBreadth 拉取大盘涨跌分布（按涨跌幅档位统计家数）。
func (s *MarketService) GetMarketBreadth() (*model.MarketBreadth, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return eastmoney.FetchMarketBreadth(ctx)
}

// GetTopics 拉取基金主题列表（约 150 个，含近 1 年涨幅；60s 内存缓存）。
func (s *MarketService) GetTopics() ([]model.TopicItem, error) {
	if v, ok := s.cache.get("topics"); ok {
		return v.([]model.TopicItem), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	list, err := eastmoney.FetchTopics(ctx)
	if err != nil {
		return nil, err
	}
	s.cache.set("topics", list)
	return list, nil
}

// GetTopicFunds 拉取某主题下的基金列表（服务端排序 + 分页；60s 内存缓存）。
// sortKey：NAVCHGRT/SYL_Z/SYL_Y/SYL_3Y/SYL_6Y/SYL_1N/SYL_JN；sortType：desc/asc。
func (s *MarketService) GetTopicFunds(topicID, sortKey, sortType string, pageIndex int) (*model.RankPage, error) {
	key := fmt.Sprintf("topicfunds|%s|%s|%s|%d", topicID, sortKey, sortType, pageIndex)
	if v, ok := s.cache.get(key); ok {
		return v.(*model.RankPage), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	page, err := eastmoney.FetchTopicFunds(ctx, topicID, sortKey, sortType, pageIndex, 50)
	if err != nil {
		return nil, err
	}
	s.cache.set(key, page)
	return page, nil
}

// GetThemeFunds 按主题（板块）代码拉取相关基金（服务端排序 + 分页；60s 内存缓存）。
// bkCode 形如 BK000641（CPO）；sortKey：RZDF/SYL_Z/SYL_Y/SYL_3Y/SYL_6Y/SYL_1N/SYL_JN；sortType：desc/asc。
func (s *MarketService) GetThemeFunds(bkCode, sortKey, sortType string, pageIndex int) (*model.RankPage, error) {
	key := fmt.Sprintf("themefunds|%s|%s|%s|%d", bkCode, sortKey, sortType, pageIndex)
	if v, ok := s.cache.get(key); ok {
		return v.(*model.RankPage), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	page, err := eastmoney.FetchThemeFunds(ctx, bkCode, sortKey, sortType, pageIndex, 50)
	if err != nil {
		return nil, err
	}
	s.cache.set(key, page)
	return page, nil
}

// GetThemeDetail 拉取某主题（板块）自身各周期涨幅与同类排名（60s 内存缓存）。
// bkCode 形如 BK000651（光模块）；用于主题相关基金页顶部展示该主题近期表现。
func (s *MarketService) GetThemeDetail(bkCode string) (*model.ThemeDetail, error) {
	key := "themedetail|" + bkCode
	if v, ok := s.cache.get(key); ok {
		return v.(*model.ThemeDetail), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	detail, err := eastmoney.FetchThemeDetail(ctx, bkCode)
	if err != nil {
		return nil, err
	}
	s.cache.set(key, detail)
	return detail, nil
}

// PreloadMarket 后台预热热门主题（默认概念板块，应用启动时调用，进入页面秒开）。
func (s *MarketService) PreloadMarket() {
	_, _ = s.GetSectors("concept")
}

// GetMonitorState 返回当前监控状态。
func (s *MarketService) GetMonitorState() (model.MonitorState, error) {
	if s.sched == nil {
		return model.MonitorState{Phase: "Idle"}, nil
	}
	return s.sched.CurrentState(), nil
}

// PauseMonitor 暂停/恢复监控。
func (s *MarketService) PauseMonitor(paused bool) error {
	if s.sched != nil {
		s.sched.Pause(paused)
	}
	return nil
}

// RefreshNow 手动触发一轮拉取。
func (s *MarketService) RefreshNow() error {
	if s.sched != nil {
		s.sched.RefreshNow()
	}
	return nil
}
