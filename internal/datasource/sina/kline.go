package sina

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 新浪 A 股指数日 K（含北证）：scale=240 即日线，datalen 控制条数，升序返回。
const cnKlineAPI = "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%%20_t=/CN_MarketDataService.getKLineData?symbol=%s&scale=240&ma=no&datalen=%d"

// 新浪美股指数日 K：返回自上市以来全部日线（无 datalen 参数），升序返回。
const usKlineAPI = "https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/var%%20_t=/US_MinKService.getDailyK?symbol=%s"

// 新浪 datalen 上限（实测大值可取，封顶避免请求过大）。
const sinaMaxDatalen = 1023

// cnKlineRow 新浪 A 股 K 线行。
type cnKlineRow struct {
	Day    string `json:"day"`
	Open   string `json:"open"`
	High   string `json:"high"`
	Low    string `json:"low"`
	Close  string `json:"close"`
	Volume string `json:"volume"`
}

// usKlineRow 新浪美股 K 线行（字段名为单字母）。
type usKlineRow struct {
	D string `json:"d"` // 日期
	O string `json:"o"` // 开
	H string `json:"h"` // 高
	L string `json:"l"` // 低
	C string `json:"c"` // 收
	V string `json:"v"` // 量
}

// FetchCNIndexKline 拉取 A 股指数 K 线（含北证 50，symbol 形如 sh000001 / bj899050）。
// period：day/week/month；周/月由日线服务端聚合。
func (Source) FetchCNIndexKline(ctx context.Context, symbol, period string, limit int) ([]model.Kline, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("指数代码为空")
	}
	datalen := dailyFetchLen(period, limit)
	url := fmt.Sprintf(cnKlineAPI, symbol, datalen)
	body, err := datasource.FetchTextLong(ctx, url, "https://finance.sina.com.cn/")
	if err != nil {
		return nil, fmt.Errorf("拉取新浪 A 股 K 线失败: %w", err)
	}
	jsonText, err := extractSinaArray(body)
	if err != nil {
		return nil, err
	}
	var rows []cnKlineRow
	if err := json.Unmarshal([]byte(jsonText), &rows); err != nil {
		return nil, fmt.Errorf("解析新浪 A 股 K 线失败: %w", err)
	}
	daily := make([]model.Kline, 0, len(rows))
	for _, r := range rows {
		k := model.Kline{
			Date:   r.Day,
			Open:   parseF(r.Open),
			High:   parseF(r.High),
			Low:    parseF(r.Low),
			Close:  parseF(r.Close),
			Volume: parseF(r.Volume),
		}
		if k.Date != "" {
			daily = append(daily, k)
		}
	}
	return finalizeKlines(daily, period, limit), nil
}

// FetchUSIndexKline 拉取美股指数 K 线（symbol 形如 .DJI / .IXIC / .INX）。
// period：day/week/month；周/月由日线服务端聚合。
func (Source) FetchUSIndexKline(ctx context.Context, symbol, period string, limit int) ([]model.Kline, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("指数代码为空")
	}
	url := fmt.Sprintf(usKlineAPI, symbol)
	body, err := datasource.FetchTextLong(ctx, url, "https://finance.sina.com.cn/")
	if err != nil {
		return nil, fmt.Errorf("拉取新浪美股 K 线失败: %w", err)
	}
	jsonText, err := extractSinaArray(body)
	if err != nil {
		return nil, err
	}
	var rows []usKlineRow
	if err := json.Unmarshal([]byte(jsonText), &rows); err != nil {
		return nil, fmt.Errorf("解析新浪美股 K 线失败: %w", err)
	}
	daily := make([]model.Kline, 0, len(rows))
	for _, r := range rows {
		k := model.Kline{
			Date:   r.D,
			Open:   parseF(r.O),
			High:   parseF(r.H),
			Low:    parseF(r.L),
			Close:  parseF(r.C),
			Volume: parseF(r.V),
		}
		if k.Date != "" {
			daily = append(daily, k)
		}
	}
	return finalizeKlines(daily, period, limit), nil
}

// dailyFetchLen 估算为产出 limit 条目标周期所需的日线条数（带冗余），并封顶。
func dailyFetchLen(period string, limit int) int {
	if limit <= 0 {
		limit = 240
	}
	var need int
	switch period {
	case "week":
		need = limit*5 + 10
	case "month":
		need = limit*23 + 30
	default:
		need = limit
	}
	if need > sinaMaxDatalen {
		need = sinaMaxDatalen
	}
	return need
}

// finalizeKlines 按周期聚合（day 直接返回）、补涨跌幅、并截取末尾 limit 条。
func finalizeKlines(daily []model.Kline, period string, limit int) []model.Kline {
	out := daily
	if period == "week" || period == "month" {
		out = aggregate(daily, period)
	}
	out = fillChangePercent(out)
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// aggregate 将日线聚合为周/月线（输入按日期升序）。
// 开=区间首日开盘，收=区间末日收盘，高=区间最高，低=区间最低，量=区间累计；日期取区间末日。
func aggregate(daily []model.Kline, period string) []model.Kline {
	if len(daily) == 0 {
		return daily
	}
	out := make([]model.Kline, 0, len(daily)/4+1)
	var cur *model.Kline
	var curKey string
	for i := range daily {
		d := daily[i]
		key := bucketKey(d.Date, period)
		if key == "" {
			continue
		}
		if cur == nil || key != curKey {
			if cur != nil {
				out = append(out, *cur)
			}
			c := d
			cur = &c
			curKey = key
			continue
		}
		// 合并到当前桶
		if d.High > cur.High {
			cur.High = d.High
		}
		if d.Low < cur.Low {
			cur.Low = d.Low
		}
		cur.Close = d.Close
		cur.Date = d.Date
		cur.Volume += d.Volume
	}
	if cur != nil {
		out = append(out, *cur)
	}
	return out
}

// bucketKey 计算某日期所属周/月的归并键。
func bucketKey(date, period string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return ""
	}
	if period == "month" {
		return t.Format("2006-01")
	}
	y, w := t.ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w)
}

// fillChangePercent 依相邻收盘价补算涨跌幅（首条为 0）。
func fillChangePercent(ks []model.Kline) []model.Kline {
	var prevClose float64
	for i := range ks {
		if prevClose > 0 {
			ks[i].ChangePercent = (ks[i].Close - prevClose) / prevClose * 100
		} else {
			ks[i].ChangePercent = 0
		}
		prevClose = ks[i].Close
	}
	return ks
}

// extractSinaArray 从新浪 JSONP/带注释响应中提取 JSON 数组体（[ ... ]）。
func extractSinaArray(body string) (string, error) {
	start := strings.Index(body, "[")
	end := strings.LastIndex(body, "]")
	if start < 0 || end < 0 || end <= start {
		return "", fmt.Errorf("新浪 K 线响应格式异常")
	}
	return body[start : end+1], nil
}

// parseF 解析字符串数字，失败返回 0。
func parseF(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return f
}
