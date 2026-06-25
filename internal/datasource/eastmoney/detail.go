package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/logger"
	"minifund/internal/model"
)

// trendRaw Data_netWorthTrend 数组元素结构。
type trendRaw struct {
	X            int64           `json:"x"`            // 毫秒时间戳
	Y            float64         `json:"y"`            // 单位净值
	EquityReturn json.RawMessage `json:"equityReturn"` // 当日涨跌幅，可能为 null
}

// managerRaw Data_currentFundManager 数组元素结构。
type managerRaw struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Pic      string `json:"pic"`
	Star     int    `json:"star"`
	WorkTime string `json:"workTime"`
	FundSize string `json:"fundSize"`
	Power    struct {
		Avr        string    `json:"avr"`
		Categories []string  `json:"categories"`
		Data       []float64 `json:"data"`
	} `json:"power"`
	Profit struct {
		Categories []string `json:"categories"`
		Series     []struct {
			Data []struct {
				Y float64 `json:"y"`
			} `json:"data"`
		} `json:"series"`
	} `json:"profit"`
}

// calcMaxDrawdown 由单位净值序列计算历史最大回撤（%）。
// 回撤 = (谷值 - 此前峰值) / 此前峰值；取整段最小者。无有效数据返回 0。
func calcMaxDrawdown(trend []model.TrendPoint) float64 {
	peak := 0.0
	maxDD := 0.0
	for _, p := range trend {
		if p.Value <= 0 {
			continue
		}
		if p.Value > peak {
			peak = p.Value
		}
		if peak > 0 {
			dd := (p.Value - peak) / peak * 100
			if dd < maxDD {
				maxDD = dd
			}
		}
	}
	return maxDD
}

// parsePingzhong 解析 pingzhongdata 脚本中的核心变量。
func parsePingzhong(script string) (*model.FundDetail, error) {
	detail := &model.FundDetail{FetchedAt: time.Now().Unix()}

	if v, ok := datasource.ExtractJSVar(script, "fS_name"); ok {
		_ = json.Unmarshal([]byte(v), &detail.Name)
	}
	if v, ok := datasource.ExtractJSVar(script, "fS_code"); ok {
		_ = json.Unmarshal([]byte(v), &detail.Code)
	}
	if detail.Code == "" {
		return nil, fmt.Errorf("pingzhongdata 解析失败：缺少基金代码")
	}
	if v, ok := datasource.ExtractJSVar(script, "fund_Rate"); ok {
		_ = json.Unmarshal([]byte(v), &detail.Rate)
	}
	if v, ok := datasource.ExtractJSVar(script, "fund_minsg"); ok {
		_ = json.Unmarshal([]byte(v), &detail.MinPurchase)
	}

	// 单位净值走势
	if v, ok := datasource.ExtractJSVar(script, "Data_netWorthTrend"); ok {
		var rows []trendRaw
		if err := json.Unmarshal([]byte(v), &rows); err == nil {
			detail.NetWorthTrend = make([]model.TrendPoint, 0, len(rows))
			for _, r := range rows {
				p := model.TrendPoint{
					Date:  time.UnixMilli(r.X).Format("2006-01-02"),
					Value: r.Y,
				}
				// equityReturn 可能为 null 或数字
				var g float64
				if len(r.EquityReturn) > 0 && string(r.EquityReturn) != "null" {
					if err := json.Unmarshal(r.EquityReturn, &g); err == nil {
						p.Growth = g
					}
				}
				detail.NetWorthTrend = append(detail.NetWorthTrend, p)
			}
			detail.MaxDrawdown = calcMaxDrawdown(detail.NetWorthTrend)
		}
	}

	// 累计净值走势：[[ms, value], ...]
	if v, ok := datasource.ExtractJSVar(script, "Data_ACWorthTrend"); ok {
		var rows [][]float64
		if err := json.Unmarshal([]byte(v), &rows); err == nil {
			detail.AcWorthTrend = make([]model.TrendPoint, 0, len(rows))
			for _, r := range rows {
				if len(r) < 2 {
					continue
				}
				detail.AcWorthTrend = append(detail.AcWorthTrend, model.TrendPoint{
					Date:  time.UnixMilli(int64(r[0])).Format("2006-01-02"),
					Value: r[1],
				})
			}
		}
	}

	// 现任基金经理
	if v, ok := datasource.ExtractJSVar(script, "Data_currentFundManager"); ok {
		var rows []managerRaw
		if err := json.Unmarshal([]byte(v), &rows); err == nil {
			for _, r := range rows {
				m := model.ManagerInfo{
					ID: r.ID, Name: r.Name, Pic: r.Pic, Star: r.Star,
					WorkTime: r.WorkTime, FundSize: r.FundSize,
					PowerAvr: r.Power.Avr, PowerCategories: r.Power.Categories, PowerData: r.Power.Data,
					ProfitCategories: r.Profit.Categories,
				}
				// 任期收益对比：profit.series[0].data 与 categories 一一对应（任期收益/同类平均/沪深300）
				if len(r.Profit.Series) > 0 {
					for _, d := range r.Profit.Series[0].Data {
						m.ProfitData = append(m.ProfitData, d.Y)
					}
				}
				// 任期回报描述取第一个对比项（任期收益）
				if len(m.ProfitData) > 0 {
					m.Profit = strconv.FormatFloat(m.ProfitData[0], 'f', 2, 64) + "%"
				}
				detail.Managers = append(detail.Managers, m)
			}
		}
	}
	return detail, nil
}

// rawPositionResponse 移动端持仓接口返回结构。
type rawPositionResponse struct {
	Datas struct {
		FundStocks []struct {
			GPDM     string `json:"GPDM"`     // 股票代码
			GPJC     string `json:"GPJC"`     // 股票简称
			JZBL     string `json:"JZBL"`     // 占净值比例
			PCTNVCHG string `json:"PCTNVCHG"` // 个股当日涨跌幅
		} `json:"fundStocks"`
	} `json:"Datas"`
}

// parseHoldings 解析重仓股 JSON。
func parseHoldings(body string) ([]model.Holding, error) {
	var raw rawPositionResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析重仓股 JSON 失败: %w", err)
	}
	holdings := make([]model.Holding, 0, len(raw.Datas.FundStocks))
	for _, st := range raw.Datas.FundStocks {
		h := model.Holding{StockCode: st.GPDM, StockName: st.GPJC}
		h.Percent, _ = strconv.ParseFloat(st.JZBL, 64)
		h.ChangePercent, _ = strconv.ParseFloat(strings.TrimSpace(st.PCTNVCHG), 64)
		holdings = append(holdings, h)
	}
	return holdings, nil
}

// 债券持仓（f10 zqcc）HTML 解析正则：apidata.content 内含按报告期分块的表格，取最新一期（首个 tbody）。
var (
	bondContentRe = regexp.MustCompile(`(?s)content:"((?:\\.|[^"\\])*)"`)
	bondTbodyRe   = regexp.MustCompile(`(?s)<tbody>(.*?)</tbody>`)
	bondRowRe     = regexp.MustCompile(`(?s)<tr>(.*?)</tr>`)
	bondCellRe    = regexp.MustCompile(`(?s)<t[dh][^>]*>(.*?)</t[dh]>`)
	htmlTagRe     = regexp.MustCompile(`<[^>]+>`)
)

// bondColumnIndices 按表头文本定位「债券代码/债券名称/占净值比例」的列下标，
// 容错东财调整列顺序（如插入市值列）导致硬编码下标错位。定位失败时回退默认 [1,2,3]。
func bondColumnIndices(content string) (code, name, pct int) {
	code, name, pct = 1, 2, 3 // 默认：序号(0)/代码(1)/名称(2)/比例(3)
	// 表头位于 <thead> 的 <tr> 内（zqcc 表格首块即最新报告期）。
	headRe := regexp.MustCompile(`(?s)<thead[^>]*>(.*?)</thead>`)
	head := headRe.FindStringSubmatch(content)
	if len(head) < 2 {
		return
	}
	thRe := regexp.MustCompile(`(?s)<th[^>]*>(.*?)</th>`)
	cells := thRe.FindAllStringSubmatch(head[1], -1)
	codeFound, nameFound, pctFound := false, false, false
	for i, c := range cells {
		txt := stripHTML(c[1])
		switch {
		case !codeFound && (strings.Contains(txt, "债券代码") || strings.Contains(txt, "代码")):
			code = i
			codeFound = true
		case !nameFound && (strings.Contains(txt, "债券名称") || strings.Contains(txt, "简称") || strings.Contains(txt, "名称")):
			name = i
			nameFound = true
		case !pctFound && (strings.Contains(txt, "占净值") || strings.Contains(txt, "比例")):
			pct = i
			pctFound = true
		}
	}
	return
}

// stripHTML 去除标签并修剪空白。
func stripHTML(s string) string {
	return strings.TrimSpace(htmlTagRe.ReplaceAllString(s, ""))
}

// unescapeJS 还原 apidata 字符串里的转义（\" \/ 与换行制表符）。
func unescapeJS(s string) string {
	r := strings.NewReplacer(`\"`, `"`, `\/`, `/`, `\r`, "", `\n`, "", `\t`, "")
	return r.Replace(s)
}

// parseBondHoldings 从 f10 债券持仓 HTML 中解析最新一期重仓债券（序号/债券代码/债券名称/占净值比例/市值）。
func parseBondHoldings(body string) []model.BondHolding {
	cm := bondContentRe.FindStringSubmatch(body)
	if len(cm) < 2 {
		return nil
	}
	content := unescapeJS(cm[1])
	// 按表头定位列下标，容错东财调整列顺序
	codeIdx, nameIdx, pctIdx := bondColumnIndices(content)
	tb := bondTbodyRe.FindStringSubmatch(content) // 首个 tbody 即最新报告期
	if len(tb) < 2 {
		return nil
	}
	out := make([]model.BondHolding, 0, 10)
	for _, row := range bondRowRe.FindAllStringSubmatch(tb[1], -1) {
		cells := bondCellRe.FindAllStringSubmatch(row[1], -1)
		if len(cells) <= codeIdx || len(cells) <= nameIdx {
			continue
		}
		code := stripHTML(cells[codeIdx][1])
		name := stripHTML(cells[nameIdx][1])
		var pct float64
		if len(cells) > pctIdx {
			pct, _ = strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(stripHTML(cells[pctIdx][1])), "%"), 64)
		}
		if code == "" && name == "" {
			continue
		}
		out = append(out, model.BondHolding{BondCode: code, BondName: name, Percent: pct})
	}
	return out
}

// FetchBondHoldings 拉取基金重仓债券（天天基金 f10 债券持仓 zqcc，最新一期）。
// 注意：该 zqcc 接口返回 **UTF-8**（与多数 f10 老接口的 GBK 不同），
// 必须用 FetchText 直接读取；若误用 GBK 解码会把 UTF-8 中文劈成「浜/杞」等乱码。
// 仅纯债/债券型基金有意义；失败返回错误，由调用方降级（不影响详情主体）。
func FetchBondHoldings(ctx context.Context, code string) ([]model.BondHolding, error) {
	url := fmt.Sprintf("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=zqcc&code=%s&rt=%d", code, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, f10Referer)
	if err != nil {
		return nil, fmt.Errorf("拉取债券持仓失败: %w", err)
	}
	return parseBondHoldings(body), nil
}

// rawInfoResponse 移动端基金详情信息接口返回结构（标签信息）。
type rawInfoResponse struct {
	Datas struct {
		FTYPE     string `json:"FTYPE"`     // 基金类型
		JJGS      string `json:"JJGS"`      // 基金公司
		INDEXNAME string `json:"INDEXNAME"` // 跟踪指数
		RISKLEVEL string `json:"RISKLEVEL"` // 风险等级 1-5
		ESTABDATE string `json:"ESTABDATE"` // 成立日期
		ENDNAV    string `json:"ENDNAV"`    // 最新规模（元）
		// 交易状态（QDII 常见单日限额，字段可能缺失，缺失时为空不展示）
		SGZT  string `json:"SGZT"`  // 申购状态
		SHZT  string `json:"SHZT"`  // 赎回状态
		MAXSG string `json:"MAXSG"` // 单日累计申购上限（元）
	} `json:"Datas"`
}

// cleanField 过滤东财空值占位（空 / "--" / "0"），返回有效值或空串。
func cleanField(s string) string {
	switch s {
	case "", "--", "0":
		return ""
	default:
		return s
	}
}

// parseFundInfo 解析基金标签信息并填充到详情。
func parseFundInfo(body string, detail *model.FundDetail) error {
	var raw rawInfoResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return fmt.Errorf("解析基金信息 JSON 失败: %w", err)
	}
	d := raw.Datas
	detail.Type = d.FTYPE
	detail.Company = d.JJGS
	if d.INDEXNAME != "--" {
		detail.IndexName = d.INDEXNAME
	}
	detail.RiskLevel = d.RISKLEVEL
	detail.EstabDate = d.ESTABDATE
	detail.Scale = d.ENDNAV
	detail.SubStatus = cleanField(d.SGZT)
	detail.RedeemStatus = cleanField(d.SHZT)
	detail.DayLimit = cleanField(d.MAXSG)
	return nil
}

// FetchFundDetail 拉取基金详情：pingzhongdata 主体 + 移动端重仓股接口。
func FetchFundDetail(ctx context.Context, code string) (*model.FundDetail, error) {
	script, err := datasource.FetchText(ctx, fmt.Sprintf("https://fund.eastmoney.com/pingzhongdata/%s.js", code), fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取基金详情失败: %w", err)
	}
	detail, err := parsePingzhong(script)
	if err != nil {
		return nil, err
	}

	// 重仓股拉取失败不影响详情主体
	posURL := fmt.Sprintf("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&FCODE=%s", code)
	if body, err := datasource.FetchText(ctx, posURL, fundReferer); err == nil {
		if holdings, err := parseHoldings(body); err == nil {
			detail.Holdings = holdings
		} else {
			logger.Warn("解析重仓股失败: code=%s err=%v", code, err)
		}
	} else {
		logger.Warn("拉取重仓股失败: code=%s err=%v", code, err)
	}

	// 重仓债券：债券型/混合债基/二级债基常同时持有股票与债券，详情页用 Tab 分别展示，
	// 因此始终补拉债券持仓（best-effort；纯股票/指数基金多为空，失败不影响主体）。
	if bonds, err := FetchBondHoldings(ctx, code); err == nil {
		detail.BondHoldings = bonds
	} else {
		logger.Warn("拉取债券持仓失败: code=%s err=%v", code, err)
	}

	// 标签信息（类型/公司/跟踪指数/风险等级/规模）拉取失败同样不影响主体
	infoURL := fmt.Sprintf("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation?deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&FCODE=%s", code)
	if body, err := datasource.FetchText(ctx, infoURL, fundReferer); err == nil {
		if err := parseFundInfo(body, detail); err != nil {
			logger.Warn("解析基金信息失败: code=%s err=%v", code, err)
		}
	} else {
		logger.Warn("拉取基金信息失败: code=%s err=%v", code, err)
	}

	// 阶段涨幅（近1月/近3月/近6月/近1年/近3年/成立来等）拉取失败不影响主体
	if returns, err := FetchFundPeriodReturns(ctx, code); err == nil {
		detail.PeriodReturns = returns
	} else {
		logger.Warn("拉取阶段涨幅失败: code=%s err=%v", code, err)
	}
	return detail, nil
}
