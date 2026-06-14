package services

import (
	"context"
	"fmt"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/datasource/sina"
	"minifund/internal/datasource/tencent"
	"minifund/internal/model"
	"minifund/internal/scheduler"
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
	cache      *ttlCache
	quoteCache *ttlCache
}

// NewMarketService 创建市场行情服务。
func NewMarketService() *MarketService {
	return &MarketService{
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

// GetSectorMoneyFlow 拉取标准行业/概念板块的主力资金净流入排行（60s 内存缓存）。
// kind：all / industry / concept。代码体系为东财标准板块码（BK0xxx，与 ztjj 主题码不同）。
func (s *MarketService) GetSectorMoneyFlow(kind string) ([]model.SectorItem, error) {
	key := "sectorflow|" + kind
	if v, ok := s.cache.get(key); ok {
		return v.([]model.SectorItem), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	list, err := eastmoney.FetchSectorMoneyFlow(ctx, kind)
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
		syms = append(syms, m.Tencent)
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
		if q, ok := bySym[m.Tencent]; ok {
			mq.Price = q.Price
			mq.Change = q.Change
			mq.ChangePercent = q.ChangePercent
		}
		out = append(out, mq)
	}
	s.quoteCache.set("center-quotes", out)
	return out, nil
}

// GetIndexKline 按指数 secid 与周期（day/week/month）拉取 K 线（60s 内存缓存）。
// 主源腾讯（A股/港股可取完整历史）；美股/北证 50 腾讯仅返回最新一根，自动回退东财 push2his。
func (s *MarketService) GetIndexKline(secid, period string) ([]model.Kline, error) {
	klt, ok := klinePeriods[period]
	if !ok {
		klt = klinePeriods["day"]
		period = "day"
	}
	limit := 240
	if period == "month" {
		limit = 120
	}
	key := fmt.Sprintf("kline|%s|%s", secid, period)
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
		return nil, fmt.Errorf("该指数历史 K 线暂不可用（数据源限制），请稍后重试")
	}
	s.cache.set(key, list)
	return list, nil
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
