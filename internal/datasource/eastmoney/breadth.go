package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// rawBreadthResponse 东财涨跌分布接口返回结构。
// fenbu 为档位数组，每个元素是 {"档位": 家数}，档位 -11~11（±11 为 >10% 档，近似涨/跌停）。
type rawBreadthResponse struct {
	Data struct {
		Qdate int              `json:"qdate"`
		Fenbu []map[string]int `json:"fenbu"`
	} `json:"data"`
}

// parseBreadth 解析涨跌分布。
func parseBreadth(body string) (*model.MarketBreadth, error) {
	var raw rawBreadthResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析涨跌分布 JSON 失败: %w", err)
	}
	if len(raw.Data.Fenbu) == 0 {
		return nil, fmt.Errorf("涨跌分布数据为空")
	}
	b := &model.MarketBreadth{Date: strconv.Itoa(raw.Data.Qdate)}
	for _, entry := range raw.Data.Fenbu {
		for k, count := range entry {
			level, err := strconv.Atoi(k)
			if err != nil {
				continue
			}
			b.Bins = append(b.Bins, model.BreadthBin{Level: level, Count: count})
			switch {
			case level > 0:
				b.UpCount += count
			case level < 0:
				b.DownCount += count
			default:
				b.FlatCount += count
			}
		}
	}
	sort.Slice(b.Bins, func(i, j int) bool { return b.Bins[i].Level < b.Bins[j].Level })
	return b, nil
}

// FetchMarketBreadth 拉取大盘涨跌分布（沪深京全市场，按涨跌幅档位统计家数）。
func FetchMarketBreadth(ctx context.Context) (*model.MarketBreadth, error) {
	url := "https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt"
	body, err := datasource.FetchText(ctx, url, "https://quote.eastmoney.com/")
	if err != nil {
		return nil, fmt.Errorf("拉取涨跌分布失败: %w", err)
	}
	return parseBreadth(body)
}
