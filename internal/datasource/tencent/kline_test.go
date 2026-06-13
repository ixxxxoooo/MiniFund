package tencent

import (
	"encoding/json"
	"math"
	"testing"
)

// TestParseTencentKlines 校验腾讯 K 线二维数组解析与涨跌幅推算。
func TestParseTencentKlines(t *testing.T) {
	raw := `[
		["2026-06-11","3979.71","3987.01","3997.48","3958.44","568545244"],
		["2026-06-12","4017.86","4031.51","4060.27","4008.18","743131092"],
		["残行","1"]
	]`
	var rows [][]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		t.Fatalf("构造测试数据失败: %v", err)
	}
	out := parseTencentKlines(rows)
	if len(out) != 2 {
		t.Fatalf("期望 2 条 K 线（残行应跳过），实际 %d 条", len(out))
	}
	first := out[0]
	if first.Date != "2026-06-11" || first.Open != 3979.71 || first.Close != 3987.01 ||
		first.High != 3997.48 || first.Low != 3958.44 || first.Volume != 568545244 {
		t.Errorf("首条 K 线解析错误: %+v", first)
	}
	if first.ChangePercent != 0 {
		t.Errorf("首条涨跌幅应为 0，实际 %v", first.ChangePercent)
	}
	// 第二条涨跌幅 = (4031.51-3987.01)/3987.01*100 ≈ 1.1161%
	want := (4031.51 - 3987.01) / 3987.01 * 100
	if math.Abs(out[1].ChangePercent-want) > 1e-6 {
		t.Errorf("次条涨跌幅推算错误: 期望 %v，实际 %v", want, out[1].ChangePercent)
	}
}

// TestRawFloat 校验字符串数字与裸数字两种形态解析。
func TestRawFloat(t *testing.T) {
	if got := rawFloat(json.RawMessage(`"4017.86"`)); got != 4017.86 {
		t.Errorf("字符串数字解析错误: %v", got)
	}
	if got := rawFloat(json.RawMessage(`51202.26`)); got != 51202.26 {
		t.Errorf("裸数字解析错误: %v", got)
	}
	if got := rawFloat(json.RawMessage(`"abc"`)); got != 0 {
		t.Errorf("非法数字应为 0: %v", got)
	}
}
