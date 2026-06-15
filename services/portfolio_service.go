package services

import (
	"fmt"
	"sort"
	"time"

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

// UpsertPosition 设为基准持仓：清空该基金现有流水，写入一笔基准买入后重算缓存。
// 供「直接编辑份额/成本」的手动覆盖入口使用，避免与流水模型冲突。
func (s *PortfolioService) UpsertPosition(code string, shares, costPrice float64) error {
	if shares <= 0 || costPrice <= 0 {
		return fmt.Errorf("份额与成本价必须大于 0")
	}
	if err := s.store.SetBaselinePosition(code, shares, costPrice); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// DeletePosition 删除持仓：清空该基金全部交易流水并移除派生缓存。
func (s *PortfolioService) DeletePosition(code string) error {
	if err := s.store.ClearTransactions(code); err != nil {
		return err
	}
	if err := s.store.DeletePosition(code); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// ListTransactions 返回某基金的交易流水（按日期升序）。
func (s *PortfolioService) ListTransactions(code string) ([]model.PositionTxn, error) {
	return s.store.ListTransactions(code)
}

// ListClearedCodes 返回「已清仓」的基金代码（曾持有、当前份额为 0），供各列表展示清仓状态。
func (s *PortfolioService) ListClearedCodes() ([]string, error) {
	return s.store.ListClearedCodes()
}

// AddTransaction 记一笔交易流水（买入/卖出），自动重算持仓份额与加权成本。
// 份额、净值需大于 0；金额留空（≤0）时按 份额 × 净值 自动计算。
func (s *PortfolioService) AddTransaction(code, date, kind string, shares, price, amount float64, note string) error {
	if kind != model.TxnKindBuy && kind != model.TxnKindSell {
		return fmt.Errorf("交易类型只能是买入或卖出")
	}
	if shares <= 0 || price <= 0 {
		return fmt.Errorf("份额与净值必须大于 0")
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if amount <= 0 {
		amount = shares * price
	}
	t := model.PositionTxn{
		Code: code, Date: date, Kind: kind, Shares: shares, Price: price,
		Amount: amount, Source: model.TxnSourceManual, Note: note,
	}
	if err := s.store.AddTransaction(t); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// DeleteTransaction 删除一笔交易流水并重算持仓。
func (s *PortfolioService) DeleteTransaction(id int64) error {
	if err := s.store.DeleteTransaction(id); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// ListDCAPlans 返回全部定投计划。
func (s *PortfolioService) ListDCAPlans() ([]model.DCAPlan, error) {
	return s.store.ListDCAPlans()
}

// UpsertDCAPlan 新增/更新定投计划（ID>0 为更新），返回写入后的计划 id。
func (s *PortfolioService) UpsertDCAPlan(plan model.DCAPlan) (int64, error) {
	if plan.Code == "" {
		return 0, fmt.Errorf("请选择定投基金")
	}
	if plan.Freq != model.DCAFreqWeekly && plan.Freq != model.DCAFreqMonthly {
		return 0, fmt.Errorf("定投周期只能是每周或每月")
	}
	if plan.Amount <= 0 {
		return 0, fmt.Errorf("定投金额必须大于 0")
	}
	id, err := s.store.UpsertDCAPlan(plan)
	if err != nil {
		return 0, err
	}
	s.notifyChange()
	return id, nil
}

// DeleteDCAPlan 删除定投计划。
func (s *PortfolioService) DeleteDCAPlan(id int64) error {
	if err := s.store.DeleteDCAPlan(id); err != nil {
		return err
	}
	s.notifyChange()
	return nil
}

// SetDCAPlanEnabled 启用/停用定投计划。
func (s *PortfolioService) SetDCAPlanEnabled(id int64, enabled bool) error {
	if err := s.store.SetDCAPlanEnabled(id, enabled); err != nil {
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
		// 盘中用估算净值；盘后/已确认时 PrevNav 经调度器校正即为最新净值
		latest := est.PrevNav
		if est.HasEstimate {
			latest = est.Estimate
		}
		summary.MarketValue += p.Shares * latest
		summary.TotalProfit += p.Shares * (latest - p.CostPrice)

		// 当日收益口径（与前端 lib/portfolio 一致）：
		//   - 盘中：PrevNav 为上一交易日净值，收益 = 份额 ×（估算净值 − 上一日净值）；
		//   - 已确认：PrevNav 为今日净值，DayGrowth 为今日涨幅，
		//     昨日净值 = PrevNav ÷ (1 + DayGrowth/100)，收益 = 份额 ×（今日净值 − 昨日净值）；
		//   - 二者皆无：当日收益记 0，分母退化为当前市值。
		switch {
		case est.HasEstimate:
			summary.TodayProfit += p.Shares * (est.Estimate - est.PrevNav)
			prevValue += p.Shares * est.PrevNav
		case est.HasDayGrowth:
			prevDayNav := est.PrevNav / (1 + est.DayGrowth/100)
			summary.TodayProfit += p.Shares * (latest - prevDayNav)
			prevValue += p.Shares * prevDayNav
		default:
			prevValue += p.Shares * latest
		}
	}
	if prevValue > 0 {
		summary.TodayPercent = summary.TodayProfit / prevValue * 100
	}
	return summary, nil
}
