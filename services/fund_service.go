package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/logger"
	"minifund/internal/model"
	"minifund/internal/storage"
)

// fundIndexMaxAge 基金代码表时效：7 天
const fundIndexMaxAge = 7 * 24 * time.Hour

// detailCacheMaxAge 基金详情缓存时效：24 小时
const detailCacheMaxAge = 24 * time.Hour

// rankingCacheTTL 排行结果内存缓存时效（页面可见才轮询，60s 足够新鲜且大幅提速翻页）。
const rankingCacheTTL = 60 * time.Second

// perfCacheTTL 搜索结果收益补全缓存时效（今日为估算、周期为日级，3 分钟足够新鲜且大幅提速翻页）。
const perfCacheTTL = 3 * time.Minute

// perfFetchConcurrency 周期收益并发拉取上限（限频规则：≤ 8）。
const perfFetchConcurrency = 6

// FundService 基金数据服务：搜索、详情、历史净值、排行。
type FundService struct {
	store     *storage.Store
	rankCache *ttlCache
	perfCache *ttlCache
}

// NewFundService 创建基金数据服务。
func NewFundService(store *storage.Store) *FundService {
	return &FundService{
		store:     store,
		rankCache: newTTLCache(rankingCacheTTL),
		perfCache: newTTLCache(perfCacheTTL),
	}
}

// EnsureFundIndex 确保基金代码表存在且未过期（应用启动时后台调用，不暴露给前端）。
func (s *FundService) EnsureFundIndex() {
	updatedAt, err := s.store.FundIndexUpdatedAt()
	if err != nil {
		logger.Warn("查询代码表时效失败: %v", err)
		return
	}
	if updatedAt > 0 && time.Since(time.Unix(updatedAt, 0)) < fundIndexMaxAge {
		return
	}
	logger.Info("基金代码表过期或为空，开始更新...")
	if err := s.RefreshFundIndex(); err != nil {
		logger.Warn("更新基金代码表失败: %v", err)
	}
}

// RefreshFundIndex 手动全量更新基金代码表（设置页调用）。
func (s *FundService) RefreshFundIndex() error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	items, err := eastmoney.FetchFundIndex(ctx)
	if err != nil {
		return fmt.Errorf("拉取基金代码表失败: %w", err)
	}
	if err := s.store.ReplaceFundIndex(items); err != nil {
		return fmt.Errorf("写入基金代码表失败: %w", err)
	}
	logger.Info("基金代码表更新完成: %d 条", len(items))
	return nil
}

// SearchFunds 本地搜索基金（代码/名称/拼音首字母/全拼），offset 用于滚动加载。
func (s *FundService) SearchFunds(keyword string, limit, offset int) ([]model.FundIndexItem, error) {
	return s.store.SearchFunds(keyword, limit, offset)
}

// rankSearchPageSize 排行页「就地搜索」每页条数（与前端 SEARCH_PAGE_SIZE 保持一致）。
const rankSearchPageSize = 30

// searchAllMax 搜索页「全量排序」一次性返回的最大命中条数。
// 搜索页需对全部结果排序（而非仅当前页），故一次取齐命中项交由前端排序+前端分页；
// 命中超过该上限时只取前 N 条（按本地索引顺序），total 仍为真实总数，前端给出截断提示。
const searchAllMax = 300

// themeCacheTTL 基金主题缓存时效：30 天（主题/概念归属变动缓慢）。
const themeCacheTTL = 30 * 24 * time.Hour

// themeFetchConcurrency 缺失主题的并发拉取上限（避免对搜索接口高频请求被限流）。
const themeFetchConcurrency = 4

// SearchFundsPage 搜索页就地搜索（本地索引分页，含总数）：匹配名称/代码/拼音，
// 公司名通常为基金名前缀（如「易方达」可命中全部易方达系基金）。
// fundType 为类型筛选键（all/gp/hh/zq/zs/qdii/fof，与排行一致；空或 all 不过滤）。pageIndex 从 1 开始。
func (s *FundService) SearchFundsPage(keyword, fundType string, pageIndex int) (*model.FundIndexPage, error) {
	return s.store.SearchFundsPage(keyword, fundType, pageIndex, rankSearchPageSize)
}

// SearchFundsAll 搜索页全量命中（最多 searchAllMax 条 + 真实总数），供前端「对全部结果排序」。
// 返回 items 为前 searchAllMax 条命中（本地索引顺序），total 为完整命中总数；
// 阶段收益与排序均由前端在该结果集上完成（前端再做客户端分页）。
func (s *FundService) SearchFundsAll(keyword, fundType string) (*model.FundIndexPage, error) {
	return s.store.SearchFundsPage(keyword, fundType, 1, searchAllMax)
}

// GetFundThemes 批量获取一组基金所属的主题/概念标签（code → 主题列表）。
// 命中缓存（30 天 TTL）直接返回；缺失项以受限并发从东财搜索接口拉取并落库缓存，
// 拉取失败的基金会被跳过（前端不展示标签），不影响整体返回。
func (s *FundService) GetFundThemes(codes []string) (map[string][]model.FundTheme, error) {
	result := make(map[string][]model.FundTheme)
	if len(codes) == 0 {
		return result, nil
	}
	// 去重
	seen := make(map[string]bool, len(codes))
	uniq := make([]string, 0, len(codes))
	for _, c := range codes {
		c = strings.TrimSpace(c)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		uniq = append(uniq, c)
	}

	caches, err := s.store.GetThemeCaches(uniq)
	if err != nil {
		logger.Warn("读取主题缓存失败: %v", err)
		caches = map[string]storage.ThemeCacheRow{}
	}

	var missing []string
	for _, c := range uniq {
		if row, ok := caches[c]; ok && time.Since(time.Unix(row.UpdatedAt, 0)) < themeCacheTTL {
			var themes []model.FundTheme
			if json.Unmarshal([]byte(row.Themes), &themes) == nil {
				result[c] = themes
			}
		} else {
			missing = append(missing, c)
		}
	}

	if len(missing) > 0 {
		var mu sync.Mutex
		sem := make(chan struct{}, themeFetchConcurrency)
		var wg sync.WaitGroup
		for _, c := range missing {
			wg.Add(1)
			sem <- struct{}{}
			go func(code string) {
				defer wg.Done()
				defer func() { <-sem }()
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				themes, err := eastmoney.FetchFundThemes(ctx, code)
				if err != nil {
					logger.Warn("拉取基金主题失败: code=%s err=%v", code, err)
					return
				}
				// 即使为空数组也缓存，避免对无主题基金反复请求
				if data, err := json.Marshal(themes); err == nil {
					if err := s.store.SaveThemeCache(code, string(data)); err != nil {
						logger.Warn("写入主题缓存失败: code=%s err=%v", code, err)
					}
				}
				mu.Lock()
				result[code] = themes
				mu.Unlock()
			}(c)
		}
		wg.Wait()
	}
	return result, nil
}

// GetFundPerformance 批量补全一组基金的阶段收益（code → 收益），供搜索结果行内展示。
// 今日涨跌与单位净值/净值日期取 fundgz（gszzl/dwjz/jzrq，单批并发），
// 近1周~成立来各周期取移动端 FundMNPeriodIncrease（受限并发，同一接口一次取齐）；
// 命中 3 分钟缓存直接返回，单只失败跳过不影响整体。
func (s *FundService) GetFundPerformance(codes []string) (map[string]model.FundPerf, error) {
	result := make(map[string]model.FundPerf)
	if len(codes) == 0 {
		return result, nil
	}

	// 去重
	seen := make(map[string]bool, len(codes))
	uniq := make([]string, 0, len(codes))
	for _, c := range codes {
		c = strings.TrimSpace(c)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		uniq = append(uniq, c)
	}

	// 命中缓存的直接返回，未命中的进入补全集合
	var missing []string
	for _, c := range uniq {
		if v, ok := s.perfCache.get("perf:" + c); ok {
			result[c] = v.(model.FundPerf)
		} else {
			missing = append(missing, c)
		}
	}
	if len(missing) == 0 {
		return result, nil
	}

	perfs := make(map[string]*model.FundPerf, len(missing))
	var mu sync.Mutex
	for _, c := range missing {
		perfs[c] = &model.FundPerf{Code: c}
	}

	// 周期收益：受限并发逐只拉取（近1周/近1月/近3月/近1年/今年来）
	var wg sync.WaitGroup
	sem := make(chan struct{}, perfFetchConcurrency)
	for _, c := range missing {
		wg.Add(1)
		sem <- struct{}{}
		go func(code string) {
			defer wg.Done()
			defer func() { <-sem }()
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			returns, err := eastmoney.FetchFundPeriodReturns(ctx, code)
			if err != nil {
				logger.Warn("拉取阶段收益失败: code=%s err=%v", code, err)
				return
			}
			mu.Lock()
			p := perfs[code]
			for _, r := range returns {
				switch r.Period {
				case "Z":
					p.WeekGrowth = r.Value
				case "Y":
					p.MonthGrowth = r.Value
				case "3Y":
					p.Month3 = r.Value
				case "6Y":
					p.Month6 = r.Value
				case "1N":
					p.Year1 = r.Value
				case "2N":
					p.Year2 = r.Value
				case "3N":
					p.Year3 = r.Value
				case "JN":
					p.Ytd = r.Value
				case "LN":
					p.SinceStart = r.Value
				}
			}
			p.HasPeriod = true
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	// 今日：单批并发拉取 fundgz 估算涨跌
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	if ests, err := eastmoney.FetchEstimates(ctx, missing); err == nil {
		for _, e := range ests {
			p, ok := perfs[e.Code]
			if !ok {
				continue
			}
			// 单位净值/净值日期来自 fundgz（dwjz/jzrq），与估值同一响应，无需额外请求。
			if e.PrevNav > 0 {
				p.Nav = e.PrevNav
				p.NavDate = e.NavDate
				p.HasNav = true
			}
			if e.HasEstimate {
				p.DayGrowth = e.EstimateGrowth
				p.HasDay = true
			}
		}
	} else {
		logger.Warn("批量拉取今日估算失败: %v", err)
	}

	// QDII 等 fundgz 无盘中估算的基金，HasDay 仍为空，搜索页「今日」列会恒为「—」。
	// 用已公布的最新历史净值日涨幅兜底（与自选表/详情页的 HasDayGrowth 口径对齐），
	// 使同一只基金在搜索页与其它页面「今日」展示一致。
	var needDay []string
	for c, p := range perfs {
		if !p.HasDay {
			needDay = append(needDay, c)
		}
	}
	if len(needDay) > 0 {
		ctx2, cancel2 := context.WithTimeout(context.Background(), 12*time.Second)
		navs := eastmoney.FetchLatestNavs(ctx2, needDay)
		cancel2()
		for _, c := range needDay {
			rec, ok := navs[c]
			if !ok || rec.Growth == 0 {
				continue
			}
			if p, ok := perfs[c]; ok {
				p.DayGrowth = rec.Growth
				p.HasDay = true
				if !p.HasNav && rec.Nav > 0 {
					p.Nav = rec.Nav
					p.NavDate = rec.Date
					p.HasNav = true
				}
			}
		}
	}

	for c, p := range perfs {
		// 仅缓存有效结果（阶段收益/今日/净值任一取到即可），避免网络抖动失败时把
		// 空/残缺 FundPerf 缓存 3 分钟，导致期间搜索结果始终显示空收益。
		// 本次调用的结果仍照常返回（残缺项前端按字段缺失渲染）。
		if p.HasPeriod || p.HasDay || p.HasNav {
			s.perfCache.set("perf:"+c, *p)
		}
		result[c] = *p
	}
	return result, nil
}

// GetFundDetail 获取基金详情（缓存优先，24h 过期后重新抓取）。
func (s *FundService) GetFundDetail(code string) (*model.FundDetail, error) {
	if cached, err := s.store.GetDetailCache(code, detailCacheMaxAge); err == nil && cached != "" {
		var detail model.FundDetail
		if json.Unmarshal([]byte(cached), &detail) == nil {
			return &detail, nil
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	detail, err := eastmoney.FetchFundDetail(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("获取基金详情失败: %w", err)
	}
	if data, err := json.Marshal(detail); err == nil {
		if err := s.store.SaveDetailCache(code, string(data)); err != nil {
			logger.Warn("写入详情缓存失败: code=%s err=%v", code, err)
		}
	}
	return detail, nil
}

// GetNavHistory 获取历史净值（分页）。
func (s *FundService) GetNavHistory(code string, pageIndex, pageSize int) (*model.NavPage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return eastmoney.FetchNavHistory(ctx, code, pageIndex, pageSize)
}

// GetFundRanking 获取基金排行（60s 内存缓存，配合前端翻页预取实现秒开）。sortType：desc/asc。
func (s *FundService) GetFundRanking(fundType, sortKey, sortType string, pageIndex int) (*model.RankPage, error) {
	key := fmt.Sprintf("%s|%s|%s|%d", fundType, sortKey, sortType, pageIndex)
	if v, ok := s.rankCache.get(key); ok {
		return v.(*model.RankPage), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// FundMNRank 单页最多 30 条，与前端分页大小保持一致
	page, err := eastmoney.FetchRanking(ctx, fundType, sortKey, sortType, pageIndex, 30)
	if err != nil {
		return nil, err
	}
	s.rankCache.set(key, page)
	return page, nil
}

// PreloadRanking 后台预热默认排行首页（应用启动时调用，进入页面秒开）。
func (s *FundService) PreloadRanking() {
	_, _ = s.GetFundRanking("all", "rzdf", "desc", 1)
}
