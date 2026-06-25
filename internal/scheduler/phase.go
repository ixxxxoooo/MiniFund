package scheduler

import "time"

// Phase 监控时段（状态机详见 docs/PRD.md 3.1 / docs/TECH_DESIGN.md 4.1）。
type Phase string

const (
	PhaseIdle       Phase = "Idle"       // 非交易时段，零请求
	PhasePreMarket  Phase = "PreMarket"  // 开盘前 09:15-09:30
	PhaseTrading    Phase = "Trading"    // 交易时段 09:30-11:30 / 13:00-15:00
	PhaseLunch      Phase = "Lunch"      // 午休 11:30-13:00
	PhaseNavConfirm Phase = "NavConfirm" // 净值确认 16:00-23:00
)

// phaseAt 计算某时刻所处的监控时段。
func phaseAt(t time.Time) Phase {
	if !IsTradingDay(t) {
		return PhaseIdle
	}
	hm := t.Hour()*60 + t.Minute()
	switch {
	case hm >= 9*60+15 && hm < 9*60+30:
		return PhasePreMarket
	case (hm >= 9*60+30 && hm < 11*60+30) || (hm >= 13*60 && hm < 15*60):
		return PhaseTrading
	case hm >= 11*60+30 && hm < 13*60:
		return PhaseLunch
	case hm >= 16*60 && hm < 23*60:
		return PhaseNavConfirm
	default:
		return PhaseIdle
	}
}

// nextChangeHint 给出下一次状态切换的提示文案（前端状态栏展示）。
func nextChangeHint(p Phase, t time.Time) string {
	switch p {
	case PhasePreMarket:
		return "09:30 开盘"
	case PhaseTrading:
		hm := t.Hour()*60 + t.Minute()
		if hm < 11*60+30 {
			return "11:30 午间休市"
		}
		return "15:00 收盘"
	case PhaseLunch:
		return "13:00 开盘"
	case PhaseNavConfirm:
		return "净值确认中（至 23:00）"
	default:
		if IsTradingDay(t) && t.Hour() < 9 {
			return "09:30 开盘"
		}
		// 交易日 15:00-16:00 虽为 Idle（收盘后净值尚未确认），但 16:00 即进入净值确认，
		// 提示「下一交易日开盘」会误导用户，单独给出净值确认提示。
		if IsTradingDay(t) && t.Hour() >= 15 && t.Hour() < 16 {
			return "16:00 净值确认"
		}
		return "下一交易日 09:30 开盘"
	}
}
