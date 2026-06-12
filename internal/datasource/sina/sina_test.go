package sina

import "testing"

func TestParseQuotes(t *testing.T) {
	body := `var hq_str_s_sh000001="上证指数,3245.1234,12.3456,0.38,3251210,40924511";` + "\n" +
		`var hq_str_s_sz399001="深证成指,10500.8800,-52.1200,-0.49,4251210,50924511";`
	quotes, err := parseQuotes(body, []string{"sh000001", "sz399001"})
	if err != nil {
		t.Fatalf("解析新浪行情失败: %v", err)
	}
	if len(quotes) != 2 {
		t.Fatalf("行情条数错误: %d", len(quotes))
	}
	if quotes[0].Name != "上证指数" || quotes[0].Price != 3245.1234 {
		t.Errorf("上证指数解析错误: %+v", quotes[0])
	}
	if quotes[1].ChangePercent != -0.49 {
		t.Errorf("深证成指解析错误: %+v", quotes[1])
	}
}
