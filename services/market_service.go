package services

import (
	"context"
	"fmt"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/model"
	"minifund/internal/scheduler"
)

// 板块/主题列表内存缓存时效（页面可见才请求，60s 足够新鲜并大幅提速）。
const marketCacheTTL = 60 * time.Second

// MarketService 市场行情服务：指数、板块、监控状态控制。
type MarketService struct {
	sched *scheduler.Scheduler
	cache *ttlCache
}

// NewMarketService 创建市场行情服务。
func NewMarketService() *MarketService {
	return &MarketService{cache: newTTLCache(marketCacheTTL)}
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
