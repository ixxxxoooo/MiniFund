package services

import (
	"fmt"

	"minifund/internal/model"
	"minifund/internal/scheduler"
	"minifund/internal/storage"
)

// PortfolioService 持仓与盈亏服务。
// 计算口径见 docs/PRD.md 2.3 节：
//   持仓市值 = 份额 × 最新净值（盘中用估算净值）
//   当日预估收益 = 份额 × (估算净值 − 上一日净值)
//   累计收益 = 份额 × (最新净值 − 成本价)
type PortfolioService struct {
	store *storage.Store
	sched *scheduler.Scheduler
}

// NewPortfolioService 创建持仓服务。
func NewPortfolioService(store *storage.Store) *PortfolioService {
	return &PortfolioService{store: store}
}

// SetScheduler 注入调度器（装配时调用，不暴露给前端使用）。
func (s *PortfolioService) SetScheduler(sched *scheduler.Scheduler) {
	s.sched = sched
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
	return s.store.UpsertPosition(code, shares, costPrice)
}

// DeletePosition 删除持仓。
func (s *PortfolioService) DeletePosition(code string) error {
	return s.store.DeletePosition(code)
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
