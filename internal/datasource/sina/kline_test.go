package sina

import (
	"math"
	"testing"

	"minifund/internal/model"
)

// TestExtractSinaArray 校验从带注释/JSONP 包装中提取 JSON 数组。
func TestExtractSinaArray(t *testing.T) {
	body := "/*<script>x</script>*/\nvar _t=([{\"day\":\"2026-06-12\",\"open\":\"1\"}]);"
	got, err := extractSinaArray(body)
	if err != nil {
		t.Fatalf("提取失败: %v", err)
	}
	if got != `[{"day":"2026-06-12","open":"1"}]` {
		t.Errorf("提取结果错误: %q", got)
	}
	if _, err := extractSinaArray("no array here"); err == nil {
		t.Error("无数组时应报错")
	}
}

// TestAggregateWeek 校验日线按周聚合（开取首、收取末、高低取极值、量累计）。
func TestAggregateWeek(t *testing.T) {
	// 2026-06-08(周一) ~ 06-12(周五) 同一 ISO 周；06-15(下周一) 新桶。
	daily := []model.Kline{
		{Date: "2026-06-08", Open: 100, High: 110, Low: 95, Close: 105, Volume: 10},
		{Date: "2026-06-09", Open: 105, High: 120, Low: 100, Close: 115, Volume: 20},
		{Date: "2026-06-12", Open: 115, High: 118, Low: 90, Close: 92, Volume: 30},
		{Date: "2026-06-15", Open: 92, High: 96, Low: 88, Close: 94, Volume: 5},
	}
	w := aggregate(daily, "week")
	if len(w) != 2 {
		t.Fatalf("期望 2 根周线，实际 %d", len(w))
	}
	first := w[0]
	if first.Open != 100 || first.Close != 92 || first.High != 120 || first.Low != 90 || first.Volume != 60 {
		t.Errorf("首根周线聚合错误: %+v", first)
	}
	if w[0].Date != "2026-06-12" {
		t.Errorf("周线日期应取区间末日: %s", w[0].Date)
	}
}

// TestFillChangePercent 校验涨跌幅按相邻收盘推算。
func TestFillChangePercent(t *testing.T) {
	ks := []model.Kline{{Close: 100}, {Close: 110}}
	ks = fillChangePercent(ks)
	if ks[0].ChangePercent != 0 {
		t.Errorf("首条涨跌幅应为 0: %v", ks[0].ChangePercent)
	}
	if math.Abs(ks[1].ChangePercent-10) > 1e-9 {
		t.Errorf("次条涨跌幅应为 10%%: %v", ks[1].ChangePercent)
	}
}
