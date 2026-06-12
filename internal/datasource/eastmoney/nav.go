package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

const f10Referer = "https://fundf10.eastmoney.com/"

// rawNavResponse 历史净值接口返回结构（注意 TotalCount 在根级，不在 Data 下）。
type rawNavResponse struct {
	Data struct {
		LSJZList []struct {
			FSRQ  string `json:"FSRQ"`  // 净值日期
			DWJZ  string `json:"DWJZ"`  // 单位净值
			LJJZ  string `json:"LJJZ"`  // 累计净值
			JZZZL string `json:"JZZZL"` // 日增长率
		} `json:"LSJZList"`
	} `json:"Data"`
	TotalCount int `json:"TotalCount"`
	ErrCode    int `json:"ErrCode"`
}

// parseNavHistory 解析历史净值 JSON。
func parseNavHistory(body string) (*model.NavPage, error) {
	var raw rawNavResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析历史净值 JSON 失败: %w", err)
	}
	if raw.ErrCode != 0 {
		return nil, fmt.Errorf("历史净值接口返回错误码: %d", raw.ErrCode)
	}
	page := &model.NavPage{Total: raw.TotalCount, Items: make([]model.NavRecord, 0, len(raw.Data.LSJZList))}
	for _, r := range raw.Data.LSJZList {
		rec := model.NavRecord{Date: r.FSRQ}
		rec.Nav, _ = strconv.ParseFloat(r.DWJZ, 64)
		rec.AccNav, _ = strconv.ParseFloat(r.LJJZ, 64)
		rec.Growth, _ = strconv.ParseFloat(r.JZZZL, 64)
		page.Items = append(page.Items, rec)
	}
	return page, nil
}

// FetchNavHistory 拉取历史净值（分页，第 1 页为最新）。
func FetchNavHistory(ctx context.Context, code string, pageIndex, pageSize int) (*model.NavPage, error) {
	if pageIndex <= 0 {
		pageIndex = 1
	}
	if pageSize <= 0 || pageSize > 50 {
		pageSize = 20
	}
	url := fmt.Sprintf("https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s&pageIndex=%d&pageSize=%d", code, pageIndex, pageSize)
	body, err := datasource.FetchText(ctx, url, f10Referer)
	if err != nil {
		return nil, fmt.Errorf("拉取历史净值失败: %w", err)
	}
	return parseNavHistory(body)
}

// FetchLatestNav 拉取最新一条净值记录（净值确认任务使用）。
func FetchLatestNav(ctx context.Context, code string) (*model.NavRecord, error) {
	page, err := FetchNavHistory(ctx, code, 1, 1)
	if err != nil {
		return nil, err
	}
	if len(page.Items) == 0 {
		return nil, fmt.Errorf("基金 %s 无净值记录", code)
	}
	return &page.Items[0], nil
}
