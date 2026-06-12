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
}

func TestParseRanking(t *testing.T) {
	body := `var rankData = {datas:["000001,华夏成长混合,HXCZHH,2026-06-11,1.2345,3.4567,0.52,1.20,3.40,5.60,8.90,15.20,20.10,30.50,12.80,200.10,2001-12-18,1,15.20,0.15%,0.15%,1,,,",` +
		`"110011,易方达优质精选混合,YFDYZJXHH,2026-06-11,5.6789,6.7890,-0.31,0.80,2.10,4.30,7.20,12.10,18.30,25.40,9.60,500.20,2008-06-19,1,12.10,0.15%,0.15%,1,,,"],allRecords:8000,pageIndex:1,pageNum:50};`
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

func TestParseSectors(t *testing.T) {
	body := `{"rc":0,"data":{"total":86,"diff":[{"f3":2.45,"f12":"BK0475","f14":"银行","f104":40,"f105":2,"f128":"招商银行"},{"f3":-1.23,"f12":"BK0438","f14":"食品饮料","f104":10,"f105":35,"f128":"贵州茅台"}]}}`
	items, err := parseSectors(body)
	if err != nil {
		t.Fatalf("解析板块失败: %v", err)
	}
	if len(items) != 2 || items[0].Name != "银行" || items[0].ChangePercent != 2.45 || items[0].UpCount != 40 {
		t.Errorf("板块条目解析错误: %+v", items[0])
	}
}
