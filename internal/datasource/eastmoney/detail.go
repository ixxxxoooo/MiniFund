package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/logger"
	"minifund/internal/model"
)

// trendRaw Data_netWorthTrend 数组元素结构。
type trendRaw struct {
	X            int64           `json:"x"` // 毫秒时间戳
	Y            float64         `json:"y"` // 单位净值
	EquityReturn json.RawMessage `json:"equityReturn"` // 当日涨跌幅，可能为 null
}

// managerRaw Data_currentFundManager 数组元素结构。
type managerRaw struct {
	Name     string `json:"name"`
	WorkTime string `json:"workTime"`
	Profit   struct {
		Categories []string `json:"categories"`
		Series     []struct {
			Data []struct {
				Y float64 `json:"y"`
			} `json:"data"`
		} `json:"series"`
	} `json:"profit"`
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
				m := model.ManagerInfo{Name: r.Name, WorkTime: r.WorkTime}
				// 任期回报取 profit 序列最后一个点
				if len(r.Profit.Series) > 0 && len(r.Profit.Series[0].Data) > 0 {
					last := r.Profit.Series[0].Data[len(r.Profit.Series[0].Data)-1]
					m.Profit = strconv.FormatFloat(last.Y, 'f', 2, 64) + "%"
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
			GPDM string `json:"GPDM"` // 股票代码
			GPJC string `json:"GPJC"` // 股票简称
			JZBL string `json:"JZBL"` // 占净值比例
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
		holdings = append(holdings, h)
	}
	return holdings, nil
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
	return detail, nil
}
