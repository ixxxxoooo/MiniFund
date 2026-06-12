// Package eastmoney 天天基金/东方财富数据源实现。
// 接口规格见 docs/DATA_SOURCES.md 第 2 节。
package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"

	"minifund/internal/datasource"
	"minifund/internal/logger"
	"minifund/internal/model"
)

const fundReferer = "https://fund.eastmoney.com/"

// estimateConcurrency 估值批量拉取并发上限（限频规则：≤ 8）
const estimateConcurrency = 8

// rawEstimate fundgz 接口原始返回结构。
type rawEstimate struct {
	FundCode string `json:"fundcode"`
	Name     string `json:"name"`
	JZRQ     string `json:"jzrq"`   // 净值日期
	DWJZ     string `json:"dwjz"`   // 单位净值
	GSZ      string `json:"gsz"`    // 估算净值
	GSZZL    string `json:"gszzl"`  // 估算涨跌幅
	GZTime   string `json:"gztime"` // 估值时间
}

// parseEstimate 解析单只基金的 fundgz JSONP 响应。
func parseEstimate(body string) (*model.FundEstimate, error) {
	jsonBody, err := datasource.StripJSONP(body)
	if err != nil {
		return nil, err
	}
	var raw rawEstimate
	if err := json.Unmarshal([]byte(jsonBody), &raw); err != nil {
		return nil, fmt.Errorf("解析估值 JSON 失败: %w", err)
	}
	est := &model.FundEstimate{
		Code:         raw.FundCode,
		Name:         raw.Name,
		NavDate:      raw.JZRQ,
		EstimateTime: raw.GZTime,
	}
	est.PrevNav, _ = strconv.ParseFloat(raw.DWJZ, 64)
	if raw.GSZ != "" && raw.GSZZL != "" {
		est.Estimate, _ = strconv.ParseFloat(raw.GSZ, 64)
		est.EstimateGrowth, _ = strconv.ParseFloat(raw.GSZZL, 64)
		est.HasEstimate = est.Estimate > 0
	}
	return est, nil
}

// FetchEstimates 批量拉取盘中估值（内部并发 ≤ 8，单只失败跳过不影响整体）。
func FetchEstimates(ctx context.Context, codes []string) ([]model.FundEstimate, error) {
	if len(codes) == 0 {
		return []model.FundEstimate{}, nil
	}
	results := make([]*model.FundEstimate, len(codes))
	sem := make(chan struct{}, estimateConcurrency)
	var wg sync.WaitGroup
	for i, code := range codes {
		wg.Add(1)
		go func(idx int, c string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			url := fmt.Sprintf("https://fundgz.1234567.com.cn/js/%s.js", c)
			body, err := datasource.FetchText(ctx, url, fundReferer)
			if err != nil {
				logger.Warn("拉取估值失败: code=%s err=%v", c, err)
				return
			}
			est, err := parseEstimate(body)
			if err != nil {
				logger.Warn("解析估值失败: code=%s err=%v", c, err)
				return
			}
			results[idx] = est
		}(i, code)
	}
	wg.Wait()

	out := make([]model.FundEstimate, 0, len(codes))
	for _, r := range results {
		if r != nil {
			out = append(out, *r)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("估值批量拉取全部失败（共 %d 只）", len(codes))
	}
	return out, nil
}
