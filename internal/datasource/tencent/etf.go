package tencent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// exchangeSymbol 基金代码转交易所行情代码：5 开头为沪市（ETF/LOF），其余（15/16/18）为深市。
func exchangeSymbol(code string) string {
	if strings.HasPrefix(code, "5") {
		return "sh" + code
	}
	return "sz" + code
}

// FetchFundQuotes 拉取场内基金（ETF/LOF）实时行情，转换为估值结构与场外基金统一展示。
// PrevNav=昨收价，Estimate=现价，EstimateGrowth=涨跌幅。
func FetchFundQuotes(ctx context.Context, codes []string) ([]model.FundEstimate, error) {
	if len(codes) == 0 {
		return []model.FundEstimate{}, nil
	}
	parts := make([]string, 0, len(codes))
	symbolToCode := make(map[string]string, len(codes))
	for _, c := range codes {
		sym := exchangeSymbol(c)
		symbolToCode[sym] = c
		parts = append(parts, "s_"+sym)
	}
	url := "https://qt.gtimg.cn/q=" + strings.Join(parts, ",")
	body, err := datasource.FetchGBKText(ctx, url, "")
	if err != nil {
		return nil, fmt.Errorf("拉取场内基金行情失败: %w", err)
	}
	return parseFundQuotes(body, symbolToCode)
}

// parseFundQuotes 解析腾讯简易行情为估值结构。
// 字段按 ~ 分隔：[0]类型 [1]名称 [2]代码 [3]现价 [4]涨跌 [5]涨跌幅
func parseFundQuotes(body string, symbolToCode map[string]string) ([]model.FundEstimate, error) {
	now := time.Now()
	out := make([]model.FundEstimate, 0, len(symbolToCode))
	for _, line := range strings.Split(body, ";") {
		line = strings.TrimSpace(line)
		eq := strings.Index(line, "=")
		if eq < 0 || !strings.HasPrefix(line, "v_s_") {
			continue
		}
		symbol := line[len("v_s_"):eq]
		code, ok := symbolToCode[symbol]
		if !ok {
			continue
		}
		f := strings.Split(strings.Trim(line[eq+1:], `"`), "~")
		if len(f) < 6 {
			continue
		}
		price, _ := strconv.ParseFloat(f[3], 64)
		change, _ := strconv.ParseFloat(f[4], 64)
		percent, _ := strconv.ParseFloat(f[5], 64)
		if price <= 0 {
			continue
		}
		// PrevNav（昨收）反推：优先用 price-change（腾讯 f[4] 为涨跌点）。
		// 平开时 change=0、prevNav=price 正确；但 change 字段缺失（停牌/集合竞价/异常返回空串）
		// 时 ParseFloat 也得 0，无法与真实平开区分。此时用涨跌幅 percent 反推兜底：
		// prevNav = price / (1 + percent/100)。两者都为 0 视为真实平开，prevNav=price。
		// 保证 PrevNav>0，避免被下游「PrevNav<=0 跳过」守卫误判为无行情而整只跳过持仓汇总。
		var prevNav float64
		switch {
		case change != 0:
			prevNav = price - change
		case percent != 0:
			prevNav = price / (1 + percent/100)
		default:
			prevNav = price
		}
		out = append(out, model.FundEstimate{
			Code:           code,
			Name:           f[1],
			PrevNav:        prevNav,
			NavDate:        now.Format("2006-01-02"),
			Estimate:       price,
			EstimateGrowth: percent,
			EstimateTime:   now.Format("2006-01-02 15:04"),
			HasEstimate:    true,
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("场内基金行情解析结果为空")
	}
	return out, nil
}
