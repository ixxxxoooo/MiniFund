// Package sina 新浪财经指数行情数据源（指数行情备源，仅支持沪深指数）。
// 接口规格见 docs/DATA_SOURCES.md 3.2 节。
package sina

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// parseQuotes 解析新浪简易行情文本：
// var hq_str_s_sh000001="上证指数,3245.1234,12.3456,0.38,3251210,40924511";
// 字段按 , 分隔：[0]名称 [1]点位 [2]涨跌点 [3]涨跌幅
func parseQuotes(body string, symbols []string) ([]model.IndexQuote, error) {
	bySymbol := make(map[string]string, len(symbols))
	for _, line := range strings.Split(body, ";") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		const prefix = "var hq_str_s_"
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			continue
		}
		symbol := line[len(prefix):eq]
		bySymbol[symbol] = strings.Trim(line[eq+1:], `"`)
	}
	quotes := make([]model.IndexQuote, 0, len(symbols))
	for _, sym := range symbols {
		value, ok := bySymbol[sym]
		if !ok || value == "" {
			continue
		}
		f := strings.Split(value, ",")
		if len(f) < 4 {
			continue
		}
		q := model.IndexQuote{Symbol: sym, Name: f[0]}
		q.Price, _ = strconv.ParseFloat(f[1], 64)
		q.Change, _ = strconv.ParseFloat(f[2], 64)
		q.ChangePercent, _ = strconv.ParseFloat(f[3], 64)
		quotes = append(quotes, q)
	}
	if len(quotes) == 0 {
		return nil, fmt.Errorf("新浪行情解析结果为空")
	}
	return quotes, nil
}

// Source 新浪指数行情源。
type Source struct{}

// FetchIndexQuotes 批量拉取指数行情（仅 sh/sz 前缀有效，港美股指数由主源覆盖）。
func (Source) FetchIndexQuotes(ctx context.Context, symbols []string) ([]model.IndexQuote, error) {
	cn := make([]string, 0, len(symbols))
	for _, s := range symbols {
		if strings.HasPrefix(s, "sh") || strings.HasPrefix(s, "sz") {
			cn = append(cn, s)
		}
	}
	if len(cn) == 0 {
		return []model.IndexQuote{}, nil
	}
	parts := make([]string, 0, len(cn))
	for _, s := range cn {
		parts = append(parts, "s_"+s)
	}
	url := "https://hq.sinajs.cn/list=" + strings.Join(parts, ",")
	// 新浪接口必须携带 Referer，否则 403
	body, err := datasource.FetchGBKText(ctx, url, "https://finance.sina.com.cn/")
	if err != nil {
		return nil, fmt.Errorf("拉取新浪行情失败: %w", err)
	}
	return parseQuotes(body, cn)
}

// Name 数据源名称（降级日志用）。
func (Source) Name() string { return "新浪财经" }
