package services

import (
	"fmt"
	"sort"

	"minifund/internal/model"
	"minifund/internal/scheduler"
	"minifund/internal/storage"
)

// PortfolioService 持仓与盈亏服务。
// 计算口径见 docs/PRD.md 2.3 节：
//
//	持仓市值 = 份额 × 最新净值（盘中用估算净值）
//	当日预估收益 = 份额 × (估算净值 − 上一日净值)
//	累计收益 = 份额 × (最新净值 − 成本价)
type PortfolioService struct {
	store *storage.Store
	sched *scheduler.Scheduler
	// getDetail 基金详情读取函数（注入 FundService.GetFundDetail，避免服务间直接引用被 bindings 生成器误判为模型）
	getDetail func(code string) (*model.FundDetail, error)
	onChange  func() // 持仓变更通知（广播给所有窗口）
}

// NewPortfolioService 创建持仓服务。
func NewPortfolioService(store *storage.Store) *PortfolioService {
	return &PortfolioService{store: store}
}

// SetScheduler 注入调度器（装配时调用，不暴露给前端使用）。
func (s *PortfolioService) SetScheduler(sched *scheduler.Scheduler) {
	s.sched = sched
}

// SetDetailProvider 注入基金详情读取函数（持仓透视需要读取详情缓存，不暴露给前端使用）。
func (s *PortfolioService) SetDetailProvider(fn func(code string) (*model.FundDetail, error)) {
	s.getDetail = fn
}

// SetOnChange 注入持仓变更回调（不暴露给前端使用）。
func (s *PortfolioService) SetOnChange(fn func()) {
	s.onChange = fn
}

// notifyChange 持仓变更后广播。
func (s *PortfolioService) notifyChange() {
	if s.onChange != nil {
		s.onChange()
	}
}

// ListPositions 返回全部持仓。
func (s *PortfolioService) ListPositions() ([]model.Position, error) {
	return s.store.ListPositions()
}

// GetPosition 查询某基金持仓（无持仓返回 nil）。
func (s *PortfolioService) GetPosition(code string) (*model.Position, error) {
	return s.store.GetPosition(code)
}

// UpsertPosition 录入/更新持仓。
func (s *PortfolioService) UpsertPosition(code string, shares, costPrice float64) error {
	if shares <= 0 || costPrice <= 0 {
		return fmt.Errorf("份额与成本价必须大于 0")
	}
	if err := s.store.UpsertPosition(code, shares, costPrice); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// DeletePosition 删除持仓。
func (s *PortfolioService) DeletePosition(code string) error {
	if err := s.store.DeletePosition(code); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// GetProfitHistory 返回组合每日收益历史（净值确认后落库的数据，升序，最多 days 天）。
func (s *PortfolioService) GetProfitHistory(days int) ([]model.ProfitHistoryPoint, error) {
	return s.store.ProfitHistory(days)
}

// GetXray 持仓透视：聚合自选基金的前十重仓股，分析股票层面暴露。
// 有持仓时按持仓市值加权；完全无持仓时按等权计算。
func (s *PortfolioService) GetXray() ([]model.XrayStock, error) {
	if s.getDetail == nil {
		return nil, fmt.Errorf("服务尚未装配完成")
	}
	codes, err := s.store.AllWatchedCodes()
	if err != nil {
		return nil, err
	}
	if len(codes) == 0 {
		return []model.XrayStock{}, nil
	}

	// 各基金权重 = 持仓市值占比；无任何持仓时等权
	estimates := map[string]model.FundEstimate{}
	if s.sched != nil {
		for _, e := range s.sched.LastEstimates() {
			estimates[e.Code] = e
		}
	}
	weights := make(map[string]float64, len(codes))
	var totalValue float64
	for _, code := range codes {
		pos, _ := s.store.GetPosition(code)
		if pos == nil {
			continue
		}
		est, ok := estimates[code]
		if !ok || est.PrevNav <= 0 {
			continue
		}
		nav := est.PrevNav
		if est.HasEstimate {
			nav = est.Estimate
		}
		v := pos.Shares * nav
		weights[code] = v
		totalValue += v
	}
	if totalValue > 0 {
		for code, v := range weights {
			weights[code] = v / totalValue
		}
	} else {
		// 等权退化
		for _, code := range codes {
			weights[code] = 1.0 / float64(len(codes))
		}
	}

	// 聚合重仓股：组合权重 = Σ(基金权重 × 股票占基金净值比例)
	type agg struct {
		name   string
		weight float64
		funds  []model.XrayFundRef
	}
	stocks := map[string]*agg{}
	for _, code := range codes {
		w := weights[code]
		if w <= 0 {
			continue
		}
		detail, err := s.getDetail(code)
		if err != nil {
			continue // 单只基金详情失败不影响整体
		}
		for _, h := range detail.Holdings {
			a, ok := stocks[h.StockCode]
			if !ok {
				a = &agg{name: h.StockName}
				stocks[h.StockCode] = a
			}
			a.weight += w * h.Percent
			a.funds = append(a.funds, model.XrayFundRef{Code: detail.Code, Name: detail.Name, Percent: h.Percent})
		}
	}

	out := make([]model.XrayStock, 0, len(stocks))
	for stockCode, a := range stocks {
		out = append(out, model.XrayStock{
			StockCode: stockCode, StockName: a.name, Weight: a.weight, Funds: a.funds,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Weight > out[j].Weight })
	return out, nil
}

// GetSummary 计算持仓盈亏汇总（基于最近一轮估值缓存）。
func (s *PortfolioService) GetSummary() (*model.PortfolioSummary, error) {
	positions, err := s.store.ListPositions()
	if err != nil {
		return nil, err
	}
	summary := &model.PortfolioSummary{PositionCount: len(positions)}
	if len(positions) == 0 {
		return summary, nil
	}

	// 估值索引
	estimates := map[string]model.FundEstimate{}
	if s.sched != nil {
		for _, e := range s.sched.LastEstimates() {
			estimates[e.Code] = e
		}
	}

	var prevValue float64 // 按昨日净值计算的市值（用于当日收益率分母）
	for _, p := range positions {
		est, ok := estimates[p.Code]
		if !ok || est.PrevNav <= 0 {
			continue // 无行情数据的持仓跳过（刚添加且未拉到估值）
		}
		// 盘中用估算净值；无盘中估值（QDII）退化为昨日净值
		latest := est.PrevNav
		if est.HasEstimate {
			latest = est.Estimate
		}
		summary.MarketValue += p.Shares * latest
		summary.TodayProfit += p.Shares * (latest - est.PrevNav)
		summary.TotalProfit += p.Shares * (latest - p.CostPrice)
		prevValue += p.Shares * est.PrevNav
	}
	if prevValue > 0 {
		summary.TodayPercent = summary.TodayProfit / prevValue * 100
	}
	return summary, nil
}
