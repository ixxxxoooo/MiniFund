package tencent

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 腾讯 K 线接口（前复权）：param=代码,周期,起,止,条数,复权。
// 指数无复权概念，qfq 不生效但接口兼容；A股/港股可取完整历史，美股仅返回最新一根。
const klineAPI = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s,%s,,,%d,qfq"

// tencentKlineResp 腾讯 K 线返回结构：data 下以「代码」为键，再以「周期」为键存放二维数组。
type tencentKlineResp struct {
	Code int                        `json:"code"`
	Data map[string]json.RawMessage `json:"data"`
}

// FetchIndexKline 拉取指数 K 线（symbol 形如 sh000001 / hkHSI；period：day/week/month；limit 条数）。
// 返回按时间升序排列的 K 线；成交额腾讯不提供置 0，涨跌幅由相邻收盘价推算。
func (Source) FetchIndexKline(ctx context.Context, symbol, period string, limit int) ([]model.Kline, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("指数代码为空")
	}
	if limit <= 0 || limit > 1000 {
		limit = 240
	}
	url := fmt.Sprintf(klineAPI, symbol, period, limit)
	body, err := datasource.FetchTextLong(ctx, url, "https://gu.qq.com/")
	if err != nil {
		return nil, fmt.Errorf("拉取腾讯 K 线失败: %w", err)
	}

	var resp tencentKlineResp
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil, fmt.Errorf("解析腾讯 K 线失败: %w", err)
	}
	raw, ok := resp.Data[symbol]
	if !ok {
		return nil, fmt.Errorf("腾讯 K 线无 %s 数据", symbol)
	}
	var bySym map[string]json.RawMessage
	if err := json.Unmarshal(raw, &bySym); err != nil {
		return nil, fmt.Errorf("解析腾讯 K 线条目失败: %w", err)
	}

	// 指数通常存于 period 键（day/week/month）；个股前复权存于 qfq+period，做双重兜底。
	var rowsRaw json.RawMessage
	if v, ok := bySym[period]; ok && len(v) > 0 {
		rowsRaw = v
	} else if v, ok := bySym["qfq"+period]; ok && len(v) > 0 {
		rowsRaw = v
	}
	if len(rowsRaw) == 0 {
		return nil, fmt.Errorf("腾讯 K 线 %s 周期 %s 为空", symbol, period)
	}
	var rows [][]json.RawMessage
	if err := json.Unmarshal(rowsRaw, &rows); err != nil {
		return nil, fmt.Errorf("解析腾讯 K 线数组失败: %w", err)
	}
	return parseTencentKlines(rows), nil
}

// parseTencentKlines 解析腾讯 K 线二维数组：每行 [日期, 开, 收, 高, 低, 量, ...]。
// 涨跌幅由相邻收盘价推算（首行为 0），成交额腾讯不提供置 0。
func parseTencentKlines(rows [][]json.RawMessage) []model.Kline {
	out := make([]model.Kline, 0, len(rows))
	var prevClose float64
	for _, r := range rows {
		if len(r) < 6 {
			continue
		}
		k := model.Kline{
			Date:   rawString(r[0]),
			Open:   rawFloat(r[1]),
			Close:  rawFloat(r[2]),
			High:   rawFloat(r[3]),
			Low:    rawFloat(r[4]),
			Volume: rawFloat(r[5]),
		}
		if k.Date == "" {
			continue
		}
		if prevClose > 0 {
			k.ChangePercent = (k.Close - prevClose) / prevClose * 100
		}
		prevClose = k.Close
		out = append(out, k)
	}
	return out
}

// rawString 将 JSON 原始值解析为字符串（兼容带引号字符串）。
func rawString(r json.RawMessage) string {
	var s string
	if json.Unmarshal(r, &s) == nil {
		return s
	}
	return strings.Trim(string(r), `"`)
}

// rawFloat 将 JSON 原始值解析为浮点（兼容字符串数字与裸数字），失败返回 0。
func rawFloat(r json.RawMessage) float64 {
	var s string
	if json.Unmarshal(r, &s) == nil {
		if f, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
			return f
		}
		return 0
	}
	var f float64
	if json.Unmarshal(r, &f) == nil {
		return f
	}
	return 0
}
