package eastmoney

import "testing"

// TestParseKlines 校验 push2his K 线行解析（日期,开,收,高,低,量,额,涨跌幅）。
func TestParseKlines(t *testing.T) {
	lines := []string{
		"2026-06-12,4017.86,4031.51,4060.27,4008.18,743131092,1537401519424.70,1.31",
		"2026-06-11,3979.71,3987.01,3997.48,3958.44,568545244,1185554610734.10,0.98",
		"残行,1,2", // 字段不足应被跳过
	}
	out := parseKlines(lines)
	if len(out) != 2 {
		t.Fatalf("期望解析 2 条 K 线，实际 %d 条", len(out))
	}
	k := out[0]
	if k.Date != "2026-06-12" || k.Open != 4017.86 || k.Close != 4031.51 ||
		k.High != 4060.27 || k.Low != 4008.18 || k.ChangePercent != 1.31 {
		t.Errorf("首条 K 线解析错误: %+v", k)
	}
	if k.Volume != 743131092 {
		t.Errorf("成交量解析错误: %v", k.Volume)
	}
}

// TestMarketCenterIndexesRegistry 校验指数清单 secid 格式合法（市场.代码）。
func TestMarketCenterIndexesRegistry(t *testing.T) {
	if len(MarketCenterIndexes) == 0 {
		t.Fatal("指数清单不应为空")
	}
	for _, m := range MarketCenterIndexes {
		if m.Secid == "" || m.Name == "" || m.Group == "" {
			t.Errorf("指数元信息字段缺失: %+v", m)
		}
		if n := len(m.Secid); n < 3 || m.Secid[1] != '.' && m.Secid[2] != '.' && m.Secid[3] != '.' {
			t.Errorf("secid 格式应为 市场.代码: %q", m.Secid)
		}
	}
}
