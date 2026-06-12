package scheduler

import "time"

// holidays A 股休市日（不含周末），需每年初维护一次。
// 维护方式见 docs/PRD.md 3.2 节：若跨年未更新，自动退化为"仅排除周末"。
var holidays = map[string]bool{
	// 2026 元旦
	"2026-01-01": true, "2026-01-02": true,
	// 2026 春节（除夕至初四，前后周末顺延）
	"2026-02-16": true, "2026-02-17": true, "2026-02-18": true, "2026-02-19": true, "2026-02-20": true,
	// 2026 清明
	"2026-04-06": true,
	// 2026 劳动节
	"2026-05-01": true, "2026-05-04": true, "2026-05-05": true,
	// 2026 端午
	"2026-06-19": true,
	// 2026 中秋
	"2026-09-25": true,
	// 2026 国庆
	"2026-10-01": true, "2026-10-02": true, "2026-10-05": true, "2026-10-06": true, "2026-10-07": true,
}

// IsTradingDay 判断给定时间是否为 A 股交易日（排除周末与节假日表）。
func IsTradingDay(t time.Time) bool {
	wd := t.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}
	return !holidays[t.Format("2006-01-02")]
}
