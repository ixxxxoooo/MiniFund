package eastmoney

import (
	"testing"

	"minifund/internal/model"
)

// 真实响应样本（已脱敏精简）

func TestParseEstimate(t *testing.T) {
	body := `jsonpgz({"fundcode":"001186","name":"富国文体健康股票","jzrq":"2026-06-11","dwjz":"0.7420","gsz":"0.7251","gszzl":"-2.28","gztime":"2026-06-12 14:30"});`
	est, err := parseEstimate(body)
	if err != nil {
		t.Fatalf("解析估值失败: %v", err)
	}
	if est.Code != "001186" || est.Name != "富国文体健康股票" {
		t.Errorf("基础字段解析错误: %+v", est)
	}
	if est.PrevNav != 0.7420 || est.Estimate != 0.7251 || est.EstimateGrowth != -2.28 {
		t.Errorf("数值字段解析错误: %+v", est)
	}
	if !est.HasEstimate {
		t.Error("应判定为有盘中估值")
	}
}

func TestParseEstimateQDII(t *testing.T) {
	// QDII 无盘中估值：gsz/gszzl 为空
	body := `jsonpgz({"fundcode":"513100","name":"国泰纳斯达克100","jzrq":"2026-06-11","dwjz":"5.1230","gsz":"","gszzl":"","gztime":""});`
	est, err := parseEstimate(body)
	if err != nil {
		t.Fatalf("解析 QDII 估值失败: %v", err)
	}
	if est.HasEstimate {
		t.Error("QDII 应判定为无盘中估值")
	}
	if est.PrevNav != 5.1230 {
		t.Errorf("昨日净值解析错误: %+v", est)
	}
}

func TestParseFundIndex(t *testing.T) {
	script := `var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","HUAXIACHENGZHANGHUNHE"],["513100","GTNSDK100","国泰纳斯达克100","QDII-指数","GUOTAINASIDAKE100"]];`
	items, err := parseFundIndex(script)
	if err != nil {
		t.Fatalf("解析代码表失败: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("代码表条数错误: %d", len(items))
	}
	if items[0].Code != "000001" || items[0].Name != "华夏成长混合" || items[0].PinyinAbbr != "HXCZHH" {
		t.Errorf("代码表字段解析错误: %+v", items[0])
	}
	if items[1].Type != "QDII-指数" {
		t.Errorf("类型字段解析错误: %+v", items[1])
	}
}

func TestParseNavHistory(t *testing.T) {
	body := `{"Data":{"LSJZList":[{"FSRQ":"2026-06-11","DWJZ":"1.2345","LJJZ":"3.4567","JZZZL":"0.52","SGZT":"开放申购","SHZT":"开放赎回"},{"FSRQ":"2026-06-10","DWJZ":"1.2281","LJJZ":"3.4503","JZZZL":"-0.31","SGZT":"开放申购","SHZT":"开放赎回"}],"FundType":"001"},"ErrCode":0,"ErrMsg":null,"TotalCount":2870,"PageSize":2,"PageIndex":1}`
	page, err := parseNavHistory(body)
	if err != nil {
		t.Fatalf("解析历史净值失败: %v", err)
	}
	if page.Total != 2870 || len(page.Items) != 2 {
		t.Fatalf("分页信息错误: total=%d items=%d", page.Total, len(page.Items))
	}
	first := page.Items[0]
	if first.Date != "2026-06-11" || first.Nav != 1.2345 || first.Growth != 0.52 {
		t.Errorf("净值记录解析错误: %+v", first)
	}
}

func TestParsePingzhong(t *testing.T) {
	script := `var fS_name = "华夏成长混合";var fS_code = "000001";` +
		`var fund_Rate = "0.15";var fund_minsg = "10";` +
		`var Data_netWorthTrend = [{"x":1765459200000,"y":1.234,"equityReturn":0.52,"unitMoney":""},{"x":1765545600000,"y":1.228,"equityReturn":null,"unitMoney":""}];` +
		`var Data_ACWorthTrend = [[1765459200000,3.456],[1765545600000,3.450]];` +
		`var Data_currentFundManager = [{"id":"30198888","name":"张三","workTime":"2年又15天","profit":{"categories":["任期收益"],"series":[{"data":[{"name":"","y":12.34}]}]}}];`
	d, err := parsePingzhong(script)
	if err != nil {
		t.Fatalf("解析详情失败: %v", err)
	}
	if d.Code != "000001" || d.Name != "华夏成长混合" || d.Rate != "0.15" {
		t.Errorf("基础字段错误: %+v", d)
	}
	if len(d.NetWorthTrend) != 2 || d.NetWorthTrend[0].Value != 1.234 || d.NetWorthTrend[0].Growth != 0.52 {
		t.Errorf("净值走势解析错误: %+v", d.NetWorthTrend)
	}
	// equityReturn 为 null 时 Growth 应为 0
	if d.NetWorthTrend[1].Growth != 0 {
		t.Errorf("null 涨跌幅应解析为 0: %+v", d.NetWorthTrend[1])
	}
	if len(d.AcWorthTrend) != 2 || d.AcWorthTrend[0].Value != 3.456 {
		t.Errorf("累计净值走势解析错误: %+v", d.AcWorthTrend)
	}
	if len(d.Managers) != 1 || d.Managers[0].Name != "张三" || d.Managers[0].Profit != "12.34%" {
		t.Errorf("基金经理解析错误: %+v", d.Managers)
	}
}

func TestParseHoldings(t *testing.T) {
	body := `{"Datas":{"fundStocks":[{"GPDM":"600519","GPJC":"贵州茅台","JZBL":"9.52","PCTNVCHG":"0.5"},{"GPDM":"300750","GPJC":"宁德时代","JZBL":"8.31","PCTNVCHG":"-0.2"}]},"ErrCode":0}`
	holdings, err := parseHoldings(body)
	if err != nil {
		t.Fatalf("解析重仓股失败: %v", err)
	}
	if len(holdings) != 2 || holdings[0].StockName != "贵州茅台" || holdings[0].Percent != 9.52 {
		t.Errorf("重仓股解析错误: %+v", holdings)
	}
	if holdings[0].ChangePercent != 0.5 || holdings[1].ChangePercent != -0.2 {
		t.Errorf("重仓股涨跌幅解析错误: %+v", holdings)
	}
}

func TestParseRanking(t *testing.T) {
	// FundMNRank 移动端排行 JSON：原生含规模（ENDNAV）与各周期收益。空字段以 "--" 表示。
	body := `{"Datas":[` +
		`{"FCODE":"000001","SHORTNAME":"华夏成长混合","FSRQ":"2026-06-11","DWJZ":"1.2345","LJJZ":"3.4567","RZDF":"0.52","SYL_Z":"1.20","SYL_Y":"3.40","SYL_3Y":"5.60","SYL_6Y":"8.90","SYL_1N":"15.20","SYL_2N":"20.10","SYL_3N":"30.50","SYL_JN":"12.80","SYL_LN":"200.10","ENDNAV":"1933605682.29"},` +
		`{"FCODE":"110011","SHORTNAME":"易方达优质精选混合","FSRQ":"2026-06-11","DWJZ":"5.6789","LJJZ":"6.7890","RZDF":"-0.31","SYL_Z":"0.80","SYL_Y":"2.10","SYL_3Y":"4.30","SYL_6Y":"7.20","SYL_1N":"12.10","SYL_2N":"18.30","SYL_3N":"25.40","SYL_JN":"9.60","SYL_LN":"500.20","ENDNAV":"--"}` +
		`],"ErrCode":0,"TotalCount":8000}`
	page, err := parseRanking(body)
	if err != nil {
		t.Fatalf("解析排行失败: %v", err)
	}
	if page.Total != 8000 || len(page.Items) != 2 {
		t.Fatalf("排行分页错误: total=%d items=%d", page.Total, len(page.Items))
	}
	first := page.Items[0]
	if first.Code != "000001" || first.DayGrowth != 0.52 || first.Year1 != 15.20 || first.Ytd != 12.80 {
		t.Errorf("排行条目解析错误: %+v", first)
	}
	// 累计净值 / 近2年 / 近3年 / 成立来 / 规模
	if first.AccNav != 3.4567 || first.Year2 != 20.10 || first.Year3 != 30.50 || first.SinceStart != 200.10 || first.Scale != 1933605682.29 {
		t.Errorf("排行新增字段解析错误: %+v", first)
	}
	// 规模为 "--" 时应解析为 0
	if page.Items[1].Scale != 0 {
		t.Errorf("空规模应为 0: %+v", page.Items[1])
	}
}

func TestParseTopics(t *testing.T) {
	body := `var result={ "Datas" : ["3e98b3ffb8d67e2f,大数据,6.1385", "d5016e2c21a149eb,黄金概念,-4.8070"], "PageIndex" : "0", "TotalCount" : "148" }`
	items, err := parseTopics(body)
	if err != nil {
		t.Fatalf("解析主题列表失败: %v", err)
	}
	if len(items) != 2 || items[0].ID != "3e98b3ffb8d67e2f" || items[0].Name != "大数据" || items[0].Year1Growth != 6.1385 {
		t.Errorf("主题条目解析错误: %+v", items)
	}
}

// TestParseBoardFlow 覆盖板块资金流解析：diff 对象形态、f3 ÷100、按净流入降序。
func TestParseBoardFlow(t *testing.T) {
	body := `{"rc":0,"data":{"total":2,"diff":{"0":{"f3":146,"f12":"BK0821","f14":"MSCI中国","f62":24273833984.0},"1":{"f3":-55,"f12":"BK0574","f14":"锂电池概念","f62":-1444722944.0}}}}`
	items, err := parseBoardFlow(body, "concept")
	if err != nil {
		t.Fatalf("解析板块资金流失败: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("期望 2 条，实际 %d", len(items))
	}
	if items[0].Code != "BK0821" || items[0].Inflow <= items[1].Inflow {
		t.Errorf("应按净流入降序: %+v", items)
	}
	if items[0].ChangePercent != 1.46 {
		t.Errorf("f3 应 ÷100 为 1.46，实际 %v", items[0].ChangePercent)
	}
	if items[0].Kind != "concept" {
		t.Errorf("类别透传错误: %q", items[0].Kind)
	}
}

func TestParseTopicFunds(t *testing.T) {
	body := `var result={"Datas":[{"TTYPE":"3e98b3ffb8d67e2f","TTYPENAME":"大数据","FCODE":"001118","SHORTNAME":"华宝事件驱动混合A","SYL_Z":"-0.5","SYL_Y":"-17.31","SYL_3Y":"-3.66","SYL_6Y":"22.8","SYL_1N":"59.49","SYL_JN":"17.79","PDATE":"2026-06-11","NAV":"1.185","NAVCHGRT":"1.46","FTYPE":"混合型-偏股"}],"PageSize":0,"PageIndex":0,"TotalCount":13,"ErrCode":0,"Pages":7}`
	page, err := parseTopicFunds(body)
	if err != nil {
		t.Fatalf("解析主题基金失败: %v", err)
	}
	if page.Total != 13 || len(page.Items) != 1 {
		t.Fatalf("主题基金分页错误: total=%d items=%d", page.Total, len(page.Items))
	}
	f := page.Items[0]
	if f.Code != "001118" || f.DayGrowth != 1.46 || f.Year1 != 59.49 || f.Nav != 1.185 {
		t.Errorf("主题基金条目解析错误: %+v", f)
	}
}

func TestParseFundInfo(t *testing.T) {
	body := `{"Datas":{"FCODE":"161725","SHORTNAME":"招商中证白酒指数(LOF)A","FTYPE":"指数型-股票","ESTABDATE":"2015-05-27","ENDNAV":"25837313173.42","RISKLEVEL":"4","JJGS":"招商基金","INDEXNAME":"中证白酒指数"},"ErrCode":0}`
	var detail model.FundDetail
	if err := parseFundInfo(body, &detail); err != nil {
		t.Fatalf("解析基金信息失败: %v", err)
	}
	if detail.Type != "指数型-股票" || detail.Company != "招商基金" || detail.IndexName != "中证白酒指数" || detail.RiskLevel != "4" {
		t.Errorf("基金信息解析错误: %+v", detail)
	}
}

func TestParseBreadth(t *testing.T) {
	body := `{"rc":0,"data":{"qdate":20260612,"fenbu":[{"-1":444},{"-11":15},{"0":61},{"2":1119},{"11":89}]}}`
	b, err := parseBreadth(body)
	if err != nil {
		t.Fatalf("解析涨跌分布失败: %v", err)
	}
	if b.UpCount != 1208 || b.DownCount != 459 || b.FlatCount != 61 {
		t.Errorf("涨跌家数统计错误: up=%d down=%d flat=%d", b.UpCount, b.DownCount, b.FlatCount)
	}
	if len(b.Bins) != 5 || b.Bins[0].Level != -11 || b.Bins[4].Level != 11 {
		t.Errorf("档位排序错误: %+v", b.Bins)
	}
}

// TestParseZTJJ 覆盖热门主题（GetZTJJListNew）解析：含数字、"--" 与 null 的值字段。
func TestParseZTJJ(t *testing.T) {
	body := `{"Data":[{"INDEXCODE":"BK000651","INDEXNAME":"光模块","D":3.21},{"INDEXCODE":"BK000049","INDEXNAME":"工业金属","D":"--"},{"INDEXCODE":"BK000292","INDEXNAME":"黄金股","D":null}]}`
	items, err := parseZTJJ(body)
	if err != nil {
		t.Fatalf("解析热门主题失败: %v", err)
	}
	if len(items) != 3 || items[0].Code != "BK000651" || items[0].Name != "光模块" {
		t.Fatalf("热门主题条目解析错误: %+v", items)
	}
	if v := rawNumber(items[0].D); v != 3.21 {
		t.Errorf("数字值解析错误: %v", v)
	}
	if v := rawNumber(items[1].D); v != 0 {
		t.Errorf(`"--" 应解析为 0，实际: %v`, v)
	}
	if v := rawNumber(items[2].D); v != 0 {
		t.Errorf("null 应解析为 0，实际: %v", v)
	}
}

// TestParseThemeFunds 覆盖主题相关基金（GetBKRelTopicFundNew）解析：数字字段与 null 容错。
func TestParseThemeFunds(t *testing.T) {
	body := `{"Data":[{"FCODE":"580001","SHORTNAME":"东吴嘉禾优势精选混合A","SYRQ":"2026-06-12","DWJZ":1.8821,"RZDF":0.13,"SYL_Z":-2.56,"SYL_Y":-2.19,"SYL_3Y":29.99,"SYL_6Y":29.64,"SYL_1N":131.33,"SYL_2N":193.25,"SYL_3N":190.17,"SYL_JN":27.71,"SYL_LN":934.14},{"FCODE":"001322","SHORTNAME":"东吴新趋势价值线混合","SYRQ":"2026-06-12","DWJZ":4.4794,"RZDF":null,"SYL_1N":null}],"ErrCode":0,"TotalCount":484}`
	page, err := parseThemeFunds(body)
	if err != nil {
		t.Fatalf("解析主题基金失败: %v", err)
	}
	if page.Total != 484 || len(page.Items) != 2 {
		t.Fatalf("主题基金分页错误: total=%d n=%d", page.Total, len(page.Items))
	}
	first := page.Items[0]
	if first.Code != "580001" || first.Nav != 1.8821 || first.DayGrowth != 0.13 || first.Year1 != 131.33 || first.SinceStart != 934.14 {
		t.Errorf("主题基金条目解析错误: %+v", first)
	}
	if page.Items[1].DayGrowth != 0 || page.Items[1].Year1 != 0 {
		t.Errorf("null 字段应为 0: %+v", page.Items[1])
	}
}

// TestParseZTJJJSONP 覆盖 JSONP 包装形态。
func TestParseZTJJJSONP(t *testing.T) {
	body := `jQuery123_456({"Data":[{"INDEXCODE":"BK000651","INDEXNAME":"光模块","SY":122.85}]});`
	items, err := parseZTJJ(body)
	if err != nil {
		t.Fatalf("解析 JSONP 热门主题失败: %v", err)
	}
	if len(items) != 1 || rawNumber(items[0].SY) != 122.85 {
		t.Errorf("JSONP 热门主题解析错误: %+v", items)
	}
}
