package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// K 线来源标识。
const (
	KSourceTencent   = "tencent"   // 腾讯（A股主要 + 港股，day/week/month 原生）
	KSourceSinaCN    = "sinaCN"    // 新浪 A 股指数（北证 50；周/月服务端聚合）
	KSourceSinaUS    = "sinaUS"    // 新浪美股指数（道指/纳指/标普；周/月服务端聚合）
	KSourceEastmoney = "eastmoney" // 东财 push2his（腾讯/新浪均无该指数时使用，如韩国 KOSPI）
)

// IndexMeta 行情中心指数元信息（名称、分组、东财 secid、腾讯符号、新浪符号与 K 线来源）。
type IndexMeta struct {
	Secid   string // 东财证券 id：市场.代码；K 线最终兜底源（push2his 常被反爬，仅兜底）
	Tencent string // 腾讯符号（如 sh000001 / hkHSI / usDJI）；实时报价（全部）+ K 线（A股主要/港股）
	Sina    string // 新浪符号；K 线来源：北证 50 用 bj899050，美股用 .DJI/.IXIC/.INX
	KSource string // K 线主源：tencent / sinaCN / sinaUS
	Name    string
	Group   string
}

// MarketCenterIndexes 行情中心展示的常见指数清单（A股 / 港股 / 美股）。
// 实时报价统一走腾讯（稳定，覆盖全部）；K 线按来源路由：
// - A股主要指数 + 港股：腾讯（完整历史，周/月原生）；
// - 北证 50：腾讯仅 1 根，改走新浪 A 股 K 线；
// - 美股：腾讯仅 1 根，改走新浪美股 K 线。
var MarketCenterIndexes = []IndexMeta{
	{"1.000001", "sh000001", "", KSourceTencent, "上证指数", "A股"},
	{"0.399001", "sz399001", "", KSourceTencent, "深证成指", "A股"},
	{"0.399006", "sz399006", "", KSourceTencent, "创业板指", "A股"},
	{"1.000688", "sh000688", "", KSourceTencent, "科创50", "A股"},
	{"0.899050", "bj899050", "bj899050", KSourceSinaCN, "北证50", "A股"},
	{"1.000300", "sh000300", "", KSourceTencent, "沪深300", "A股"},
	{"1.000016", "sh000016", "", KSourceTencent, "上证50", "A股"},
	{"1.000905", "sh000905", "", KSourceTencent, "中证500", "A股"},
	{"1.000852", "sh000852", "", KSourceTencent, "中证1000", "A股"},
	{"100.HSI", "hkHSI", "", KSourceTencent, "恒生指数", "港股"},
	{"100.HSCEI", "hkHSCEI", "", KSourceTencent, "国企指数", "港股"},
	{"100.DJIA", "usDJI", ".DJI", KSourceSinaUS, "道琼斯", "美股"},
	{"100.IXIC", "usIXIC", ".IXIC", KSourceSinaUS, "纳斯达克", "美股"},
	{"100.NDX", "usNDX", ".NDX", KSourceSinaUS, "纳斯达克100", "美股"},
	{"100.SPX", "usINX", ".INX", KSourceSinaUS, "标普500", "美股"},
	// 韩国 KOSPI：腾讯/新浪均无对应符号，实时报价走东财 ulist（100.KS11），K 线走东财兜底。
	{"100.KS11", "", "", KSourceEastmoney, "韩国KOSPI", "韩国"},
}

// FindIndexBySecid 按 secid 查找行情中心指数元信息（服务层做主源/兜底切换用）。
func FindIndexBySecid(secid string) (IndexMeta, bool) {
	for _, m := range MarketCenterIndexes {
		if m.Secid == secid {
			return m, true
		}
	}
	return IndexMeta{}, false
}

// 行情中心接口 Referer（缺省 UA 也能取，但带 Referer 更接近浏览器，降低被反爬概率）。
const quoteCenterReferer = "https://quote.eastmoney.com/center/"

// 指数批量实时报价（ulist.np）：f2 价 / f3 涨跌幅 / f4 涨跌点 / f12 代码 / f13 市场 / f14 名称。
const indexRealtimeAPI = "https://push2.eastmoney.com/api/qt/ulist.np/get?secids=%s&fields=f2,f3,f4,f12,f13,f14&fltt=2&_=%d"

// 指数 K 线（push2his）：fields2 依次 f51 日期 / f52 开 / f53 收 / f54 高 / f55 低 / f56 量 / f57 额 / f58 涨跌幅。
const indexKlineAPI = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=%d&fqt=0&end=20500101&lmt=%d"

// rawIndexRealtimeResponse ulist.np 返回结构。
type rawIndexRealtimeResponse struct {
	Data struct {
		Diff []struct {
			Code   string          `json:"f12"`
			Market int             `json:"f13"`
			Name   string          `json:"f14"`
			Price  json.RawMessage `json:"f2"`
			Pct    json.RawMessage `json:"f3"`
			Chg    json.RawMessage `json:"f4"`
		} `json:"diff"`
	} `json:"data"`
}

// FetchMarketCenterQuotes 拉取行情中心指数清单的实时报价（单请求批量，按清单顺序返回）。
func FetchMarketCenterQuotes(ctx context.Context) ([]model.MarketIndexQuote, error) {
	metaBySecid := make(map[string]IndexMeta, len(MarketCenterIndexes))
	metaByCode := make(map[string]IndexMeta, len(MarketCenterIndexes)) // 代码（大写）→ 元信息，市场号不一致时回退
	secids := make([]string, 0, len(MarketCenterIndexes))
	for _, m := range MarketCenterIndexes {
		metaBySecid[m.Secid] = m
		if i := strings.LastIndex(m.Secid, "."); i >= 0 {
			metaByCode[strings.ToUpper(m.Secid[i+1:])] = m
		}
		secids = append(secids, m.Secid)
	}

	url := fmt.Sprintf(indexRealtimeAPI, strings.Join(secids, ","), time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, quoteCenterReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取指数实时行情失败: %w", err)
	}
	var raw rawIndexRealtimeResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析指数实时行情失败: %w", err)
	}

	// 接口返回顺序不固定，先按 secid 建索引，再按清单顺序输出，保证分组展示稳定。
	bySecid := make(map[string]model.MarketIndexQuote, len(raw.Data.Diff))
	for _, d := range raw.Data.Diff {
		secid := fmt.Sprintf("%d.%s", d.Market, d.Code)
		meta, ok := metaBySecid[secid]
		if !ok {
			// 市场号不一致（全球指数常见）时按代码回退匹配，并以清单 secid 为准。
			if m, ok2 := metaByCode[strings.ToUpper(d.Code)]; ok2 {
				meta, secid, ok = m, m.Secid, true
			}
		}
		if !ok {
			continue
		}
		bySecid[secid] = model.MarketIndexQuote{
			Secid:         secid,
			Name:          meta.Name,
			Group:         meta.Group,
			Price:         rawNumber(d.Price),
			Change:        rawNumber(d.Chg),
			ChangePercent: rawNumber(d.Pct),
		}
	}

	out := make([]model.MarketIndexQuote, 0, len(MarketCenterIndexes))
	for _, m := range MarketCenterIndexes {
		if q, ok := bySecid[m.Secid]; ok {
			out = append(out, q)
		} else {
			// 实时缺失（如美股休市无最新数据）时仍占位展示名称，避免列表残缺。
			out = append(out, model.MarketIndexQuote{Secid: m.Secid, Name: m.Name, Group: m.Group})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("指数实时行情为空")
	}
	return out, nil
}

// FetchIndexQuotesBySecids 按 secid 列表批量拉取实时报价（ulist.np），返回 secid → 报价。
// 仅填充价格/涨跌字段（名称、分组由调用方按清单补全），用于腾讯无符号指数（如韩国 KOSPI）的实时补缺。
// 全球指数（如 KOSPI）在 ulist 返回的 f13 市场号 / f12 代码大小写可能与请求不完全一致，
// 因此除按「市场.代码」精确匹配外，再按「代码（忽略大小写）」回退匹配到请求的 secid，避免漏填。
func FetchIndexQuotesBySecids(ctx context.Context, secids []string) (map[string]model.MarketIndexQuote, error) {
	out := make(map[string]model.MarketIndexQuote, len(secids))
	if len(secids) == 0 {
		return out, nil
	}
	// 请求代码（大写）→ 请求 secid，用于市场号不一致时按代码回退匹配。
	codeToReq := make(map[string]string, len(secids))
	for _, sid := range secids {
		if i := strings.LastIndex(sid, "."); i >= 0 {
			codeToReq[strings.ToUpper(sid[i+1:])] = sid
		}
	}
	url := fmt.Sprintf(indexRealtimeAPI, strings.Join(secids, ","), time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, quoteCenterReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取指数实时行情失败: %w", err)
	}
	var raw rawIndexRealtimeResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析指数实时行情失败: %w", err)
	}
	for _, d := range raw.Data.Diff {
		// 优先用请求清单里的原始 secid 作为键（按代码回退匹配），保证调用方按清单 secid 能取到。
		key := fmt.Sprintf("%d.%s", d.Market, d.Code)
		if req, ok := codeToReq[strings.ToUpper(d.Code)]; ok {
			key = req
		}
		out[key] = model.MarketIndexQuote{
			Secid:         key,
			Price:         rawNumber(d.Price),
			Change:        rawNumber(d.Chg),
			ChangePercent: rawNumber(d.Pct),
		}
	}
	return out, nil
}

// rawKlineResponse push2his K 线返回结构。
type rawKlineResponse struct {
	Data struct {
		Klines []string `json:"klines"`
	} `json:"data"`
}

// FetchIndexKline 拉取指数 K 线（secid 形如 1.000001；klt：101 日 / 102 周 / 103 月 / 5 五分钟等；limit 条数）。
func FetchIndexKline(ctx context.Context, secid string, klt, limit int) ([]model.Kline, error) {
	if strings.TrimSpace(secid) == "" {
		return nil, fmt.Errorf("指数代码为空")
	}
	if limit <= 0 || limit > 1000 {
		limit = 240
	}
	url := fmt.Sprintf(indexKlineAPI, secid, klt, limit)
	body, err := datasource.FetchText(ctx, url, quoteCenterReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取指数 K 线失败: %w", err)
	}
	var raw rawKlineResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析指数 K 线失败: %w", err)
	}
	return parseKlines(raw.Data.Klines), nil
}

// parseKlines 解析 push2his 的 klines 数组（每行 "日期,开,收,高,低,量,额,涨跌幅"）。
func parseKlines(lines []string) []model.Kline {
	out := make([]model.Kline, 0, len(lines))
	for _, line := range lines {
		f := strings.Split(line, ",")
		if len(f) < 8 {
			continue
		}
		out = append(out, model.Kline{
			Date:          f[0],
			Open:          parseFloatOr0(f[1]),
			Close:         parseFloatOr0(f[2]),
			High:          parseFloatOr0(f[3]),
			Low:           parseFloatOr0(f[4]),
			Volume:        parseFloatOr0(f[5]),
			Amount:        parseFloatOr0(f[6]),
			ChangePercent: parseFloatOr0(f[7]),
		})
	}
	return out
}
