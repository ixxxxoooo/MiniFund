package services

import "testing"

// TestDefaultSettings 校验默认设置符合 PRD 约定。
func TestDefaultSettings(t *testing.T) {
	s := defaultSettings()
	if s.Theme != "system" {
		t.Errorf("默认主题应为 system，实际为 %s", s.Theme)
	}
	if s.QuoteColorScheme != "cn" {
		t.Errorf("默认涨跌配色应为 cn（红涨绿跌），实际为 %s", s.QuoteColorScheme)
	}
	if s.RefreshIntervalSec != 30 {
		t.Errorf("默认刷新间隔应为 30 秒，实际为 %d", s.RefreshIntervalSec)
	}
	if s.CloseAction != "hide" {
		t.Errorf("默认关闭行为应为 hide（隐藏到托盘），实际为 %s", s.CloseAction)
	}
	if len(s.WatchedIndexes) == 0 || s.WatchedIndexes[0] != "sh000001" {
		t.Errorf("默认指数列表错误: %+v", s.WatchedIndexes)
	}
}
