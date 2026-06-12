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
