// Package tencent 腾讯财经指数行情数据源（指数行情主源）。
// 接口规格见 docs/DATA_SOURCES.md 3.1 节。
package tencent

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// parseQuotes 解析腾讯简易行情文本：
// v_s_sh000001="1~上证指数~000001~3245.12~12.34~0.38~...";
// 字段按 ~ 分隔：[0]类型 [1]名称 [2]代码 [3]点位 [4]涨跌点 [5]涨跌幅
func parseQuotes(body string, symbols []string) ([]model.IndexQuote, error) {
	quotes := make([]model.IndexQuote, 0, len(symbols))
	bySymbol := make(map[string]string, len(symbols))
	for _, line := range strings.Split(body, ";") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 形如 v_s_sh000001="..."
		eq := strings.Index(line, "=")
		if eq < 0 || !strings.HasPrefix(line, "v_s_") {
			continue
		}
		symbol := line[len("v_s_"):eq]
		value := strings.Trim(line[eq+1:], `"`)
		bySymbol[symbol] = value
	}
	for _, sym := range symbols {
		value, ok := bySymbol[sym]
		if !ok {
			continue
		}
		f := strings.Split(value, "~")
		if len(f) < 6 {
			continue
		}
		q := model.IndexQuote{Symbol: sym, Name: f[1]}
		q.Price, _ = strconv.ParseFloat(f[3], 64)
		q.Change, _ = strconv.ParseFloat(f[4], 64)
		q.ChangePercent, _ = strconv.ParseFloat(f[5], 64)
		quotes = append(quotes, q)
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("腾讯行情解析结果为空")
	}
	return quotes, nil
}

// Source 腾讯指数行情源。
type Source struct{}

// FetchIndexQuotes 批量拉取指数行情（一次请求合并多个代码）。
func (Source) FetchIndexQuotes(ctx context.Context, symbols []string) ([]model.IndexQuote, error) {
	if len(symbols) == 0 {
		return []model.IndexQuote{}, nil
	}
	parts := make([]string, 0, len(symbols))
	for _, s := range symbols {
		parts = append(parts, "s_"+s)
	}
	url := "https://qt.gtimg.cn/q=" + strings.Join(parts, ",")
	body, err := datasource.FetchGBKText(ctx, url, "")
	if err != nil {
		return nil, fmt.Errorf("拉取腾讯行情失败: %w", err)
	}
	return parseQuotes(body, symbols)
}

// Name 数据源名称（降级日志用）。
func (Source) Name() string { return "腾讯财经" }
