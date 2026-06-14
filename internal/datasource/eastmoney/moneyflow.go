package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 板块资金流量站点 push2delay（延迟行情站点；普通 push2 对桌面端 Go 请求会被反爬静默断连，delay 站点可达）。
// fs：m:90+t:2 行业板块 / m:90+t:3 概念板块；fid=f62 主力净流入排序。
const moneyFlowAPI = "https://push2delay.eastmoney.com/api/qt/clist/get?fid=f62&po=1&np=1&pz=200&pn=1&fs=%s&fields=f12,f14,f3,f62&_=%d"

// moneyFlowFs 资金流类别 → clist fs 过滤串（all 合并行业+概念）。
var moneyFlowFs = map[string]string{
	"all":      "m:90+t:2,m:90+t:3",
	"industry": "m:90+t:2",
	"concept":  "m:90+t:3",
}

// clistResp push2 clist 通用响应。
type clistResp struct {
	Data *struct {
		Total int             `json:"total"`
		Diff  json.RawMessage `json:"diff"` // 数组或对象（{"0":{...}}）两种形态
	} `json:"data"`
}

// boardFlowRow 板块资金流单行。
type boardFlowRow struct {
	F3  json.RawMessage `json:"f3"`  // 今日涨跌幅（百分数 ×100）
	F12 string          `json:"f12"` // 板块代码
	F14 string          `json:"f14"` // 板块名称
	F62 json.RawMessage `json:"f62"` // 主力净流入（元）
}

// parseBoardFlow 解析板块资金流响应（diff 兼容数组 / 对象两种形态），按主力净流入降序。
func parseBoardFlow(body, kind string) ([]model.SectorItem, error) {
	var resp clistResp
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil, fmt.Errorf("解析板块资金流 JSON 失败: %w", err)
	}
	if resp.Data == nil || len(resp.Data.Diff) == 0 {
		return nil, fmt.Errorf("板块资金流响应为空")
	}
	rows := make([]boardFlowRow, 0, 200)
	// diff 优先按数组解析，失败再按对象（map）解析。
	if err := json.Unmarshal(resp.Data.Diff, &rows); err != nil {
		var m map[string]boardFlowRow
		if err2 := json.Unmarshal(resp.Data.Diff, &m); err2 != nil {
			return nil, fmt.Errorf("解析板块资金流 diff 失败: %w", err)
		}
		for _, v := range m {
			rows = append(rows, v)
		}
	}
	out := make([]model.SectorItem, 0, len(rows))
	for _, r := range rows {
		if r.F12 == "" {
			continue
		}
		out = append(out, model.SectorItem{
			Code:          r.F12,
			Name:          r.F14,
			ChangePercent: rawNumber(r.F3) / 100, // clist f3 为百分数 ×100
			Inflow:        rawNumber(r.F62),
			Kind:          kind,
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("板块资金流解析结果为空")
	}
	// 主力净流入降序（接口已排序，这里兜底保证顺序稳定）。
	sort.SliceStable(out, func(i, j int) bool { return out[i].Inflow > out[j].Inflow })
	return out, nil
}

// FetchSectorMoneyFlow 拉取标准行业/概念板块的主力资金净流入排行（今日）。
// kind：all / industry / concept。代码体系为东财标准板块码（BK0xxx），与 ztjj 主题码（BK000xxx）不同。
func FetchSectorMoneyFlow(ctx context.Context, kind string) ([]model.SectorItem, error) {
	fs, ok := moneyFlowFs[kind]
	if !ok {
		kind = "all"
		fs = moneyFlowFs["all"]
	}
	url := fmt.Sprintf(moneyFlowAPI, fs, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, "https://data.eastmoney.com/")
	if err != nil {
		return nil, fmt.Errorf("拉取板块资金流失败: %w", err)
	}
	return parseBoardFlow(body, kind)
}
