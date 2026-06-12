// 测试涵盖指数行情与场内基金行情解析。
package tencent

import "testing"

func TestParseQuotes(t *testing.T) {
	body := `v_s_sh000001="1~上证指数~000001~3245.12~12.34~0.38~325121043~409245110~";` + "\n" +
		`v_s_hkHSI="100~恒生指数~HSI~24500.55~-120.30~-0.49~0~0~";`
	quotes, err := parseQuotes(body, []string{"sh000001", "hkHSI"})
	if err != nil {
		t.Fatalf("解析腾讯行情失败: %v", err)
	}
	if len(quotes) != 2 {
		t.Fatalf("行情条数错误: %d", len(quotes))
	}
	if quotes[0].Name != "上证指数" || quotes[0].Price != 3245.12 || quotes[0].ChangePercent != 0.38 {
		t.Errorf("上证指数解析错误: %+v", quotes[0])
	}
	if quotes[1].Symbol != "hkHSI" || quotes[1].ChangePercent != -0.49 {
		t.Errorf("恒生指数解析错误: %+v", quotes[1])
	}
}

func TestParseFundQuotes(t *testing.T) {
	body := `v_s_sh510300="1~沪深300ETF~510300~4.012~0.032~0.80~123456~49504~";` + "\n" +
		`v_s_sz159915="51~创业板ETF~159915~2.150~-0.011~-0.51~654321~140119~";`
	out, err := parseFundQuotes(body, map[string]string{"sh510300": "510300", "sz159915": "159915"})
	if err != nil {
		t.Fatalf("解析场内基金行情失败: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("行情条数错误: %d", len(out))
	}
	for _, e := range out {
		if e.Code == "510300" {
			if e.Estimate != 4.012 || e.EstimateGrowth != 0.80 || !e.HasEstimate {
				t.Errorf("沪深300ETF 解析错误: %+v", e)
			}
			// 昨收 = 现价 - 涨跌
			if diff := e.PrevNav - 3.98; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("昨收计算错误: %v", e.PrevNav)
			}
		}
	}
}

func TestExchangeSymbol(t *testing.T) {
	if exchangeSymbol("510300") != "sh510300" || exchangeSymbol("159915") != "sz159915" {
		t.Errorf("交易所代码转换错误")
	}
}
