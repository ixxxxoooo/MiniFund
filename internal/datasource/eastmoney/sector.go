package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// rawSectorResponse push2 板块行情返回结构。
// fltt=2 时数值字段为浮点数；停牌等异常时可能返回字符串 "-"，用 RawMessage 容错。
type rawSectorResponse struct {
	Data struct {
		Diff []struct {
			F3   json.RawMessage `json:"f3"`   // 涨跌幅
			F12  string          `json:"f12"`  // 板块代码
			F14  string          `json:"f14"`  // 板块名称
			F104 json.RawMessage `json:"f104"` // 上涨家数
			F105 json.RawMessage `json:"f105"` // 下跌家数
			F128 string          `json:"f128"` // 领涨股名称
		} `json:"diff"`
	} `json:"data"`
}

// rawNumber 解析可能为数字或 "-" 的字段。
func rawNumber(raw json.RawMessage) float64 {
	var v float64
	if err := json.Unmarshal(raw, &v); err == nil {
		return v
	}
	return 0
}

// parseSectors 解析板块行情 JSON。
func parseSectors(body string) ([]model.SectorItem, error) {
	var raw rawSectorResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析板块行情 JSON 失败: %w", err)
	}
	items := make([]model.SectorItem, 0, len(raw.Data.Diff))
	for _, d := range raw.Data.Diff {
		items = append(items, model.SectorItem{
			Code:          d.F12,
			Name:          d.F14,
			ChangePercent: rawNumber(d.F3),
			UpCount:       int(rawNumber(d.F104)),
			DownCount:     int(rawNumber(d.F105)),
			LeadStock:     d.F128,
		})
	}
	return items, nil
}

// FetchSectors 拉取板块行情。kind：industry（行业）/ concept（概念）。
func FetchSectors(ctx context.Context, kind string) ([]model.SectorItem, error) {
	fs := "m:90+t:2+f:!50" // 行业板块
	if kind == "concept" {
		fs = "m:90+t:3+f:!50" // 概念板块
	}
	url := fmt.Sprintf(
		"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=%s&fields=f3,f12,f14,f104,f105,f128",
		fs)
	body, err := datasource.FetchText(ctx, url, fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取板块行情失败: %w", err)
	}
	return parseSectors(body)
}
