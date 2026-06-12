package scheduler

import (
	"testing"
	"time"
)

// mustTime 构造测试时间（本地时区）。
func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	tm, err := time.ParseInLocation("2006-01-02 15:04", value, time.Local)
	if err != nil {
		t.Fatalf("解析时间失败: %v", err)
	}
	return tm
}

func TestPhaseAt(t *testing.T) {
	cases := []struct {
		at   string
		want Phase
	}{
		{"2026-06-12 08:00", PhaseIdle},       // 交易日开盘前
		{"2026-06-12 09:20", PhasePreMarket},  // 开盘前准备
		{"2026-06-12 10:00", PhaseTrading},    // 上午交易
		{"2026-06-12 12:00", PhaseLunch},      // 午休
		{"2026-06-12 14:30", PhaseTrading},    // 下午交易
		{"2026-06-12 15:30", PhaseIdle},       // 收盘后、净值确认前
		{"2026-06-12 18:00", PhaseNavConfirm}, // 净值确认窗口
		{"2026-06-12 23:30", PhaseIdle},       // 深夜
		{"2026-06-13 10:00", PhaseIdle},       // 周六
		{"2026-10-01 10:00", PhaseIdle},       // 国庆节假日
	}
	for _, c := range cases {
		if got := phaseAt(mustTime(t, c.at)); got != c.want {
			t.Errorf("phaseAt(%s) = %s, 期望 %s", c.at, got, c.want)
		}
	}
}

func TestIsTradingDay(t *testing.T) {
	if !IsTradingDay(mustTime(t, "2026-06-12 10:00")) {
		t.Error("2026-06-12（周五）应为交易日")
	}
	if IsTradingDay(mustTime(t, "2026-06-14 10:00")) {
		t.Error("2026-06-14（周日）不应为交易日")
	}
	if IsTradingDay(mustTime(t, "2026-02-17 10:00")) {
		t.Error("2026-02-17（春节）不应为交易日")
	}
}

func TestFormatTrayTitle(t *testing.T) {
	if got := formatTrayTitle(1.236, false); got != "▲1.24%" {
		t.Errorf("上涨标题格式错误: %s", got)
	}
	if got := formatTrayTitle(-0.86, false); got != "▼0.86%" {
		t.Errorf("下跌标题格式错误: %s", got)
	}
	// 摸鱼模式：无方向符号
	if got := formatTrayTitle(-2.5, true); got != "2.50%" {
		t.Errorf("摸鱼模式标题格式错误: %s", got)
	}
}
