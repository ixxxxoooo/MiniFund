package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/logger"
	"minifund/internal/model"
)

// ztjjReferer 天天基金「热门主题」页 Referer。
const ztjjReferer = "https://fund.eastmoney.com/ztjj/default.html"

// ztjjCategory 板块类别 → GetZTJJListNew 的 tt 参数：全部 0 / 行业 001002 / 概念 001003。
var ztjjCategory = map[string]string{
	"all":      "0",
	"industry": "001002",
	"concept":  "001003",
}

// ztjjItem GetZTJJListNew 单条记录。
// 值字段名随 dt/st（数据类型/周期）变化：
//   - dt=syl（涨幅）：D 今日 / W 近1周 / M 近1月 / Q 近3月 / SY 今年来；
//   - dt=zjlr（资金流入）：FLOW 今日 / FLOW_W 近1周 / FLOW_M 近1月 / FLOW_Q 近3月（单位：元）。
//
// 用 RawMessage 容错（数字或 "--"/null）。
type ztjjItem struct {
	Code  string          `json:"INDEXCODE"`
	Name  string          `json:"INDEXNAME"`
	D     json.RawMessage `json:"D"`
	W     json.RawMessage `json:"W"`
	M     json.RawMessage `json:"M"`
	Q     json.RawMessage `json:"Q"`
	SY    json.RawMessage `json:"SY"`
	Flow  json.RawMessage `json:"FLOW"`   // 今日（实时）主力资金净流入（元）
	FlowW json.RawMessage `json:"FLOW_W"` // 近1周主力资金净流入（元）
	FlowM json.RawMessage `json:"FLOW_M"` // 近1月主力资金净流入（元）
	FlowQ json.RawMessage `json:"FLOW_Q"` // 近3月主力资金净流入（元）
}

// ztjjFlowStage 资金流入阶段键（前端 Stage）→ GetZTJJListNew 的 st 周期：
// 实时 FLOW / 近1周 FLOW_W / 近1月 FLOW_M / 近3月 FLOW_Q。
var ztjjFlowStage = map[string]string{
	"now":   "FLOW",
	"week":  "FLOW_W",
	"month": "FLOW_M",
	"m3":    "FLOW_Q",
}

// flowField 取某资金流入周期(st)对应的原始值字段。
func flowField(it ztjjItem, st string) json.RawMessage {
	switch st {
	case "FLOW_W":
		return it.FlowW
	case "FLOW_M":
		return it.FlowM
	case "FLOW_Q":
		return it.FlowQ
	default:
		return it.Flow
	}
}

// ztjjResponse GetZTJJListNew 返回结构。
type ztjjResponse struct {
	Data []ztjjItem `json:"Data"`
}

// rawNumber 解析可能为数字、字符串或缺失的 JSON 字段为 float64。
func rawNumber(raw json.RawMessage) float64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return f
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
		return v
	}
	return 0
}

// parseZTJJ 解析 GetZTJJListNew 响应（兼容纯 JSON 与 JSONP 包装）。
func parseZTJJ(body string) ([]ztjjItem, error) {
	body = strings.TrimSpace(body)
	if !strings.HasPrefix(body, "{") {
		if j, err := datasource.StripJSONP(body); err == nil {
			body = j
		}
	}
	var resp ztjjResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil, fmt.Errorf("解析热门主题 JSON 失败: %w", err)
	}
	return resp.Data, nil
}

// fetchZTJJ 拉取某类别(tt)、某数据类型(dt)、某周期(st) 的热门主题列表（接口已按该指标降序）。
// dt=syl 涨幅，st 取 D/W/M/Q/SY；dt=zjlr 资金流入，st 取 FLOW/FLOW_W/FLOW_M/FLOW_Q。
func fetchZTJJ(ctx context.Context, tt, dt, st string) ([]ztjjItem, error) {
	url := fmt.Sprintf(
		"https://api.fund.eastmoney.com/ztjj/GetZTJJListNew?tt=%s&dt=%s&st=%s&pi=1&pn=500&_=%d",
		tt, dt, st, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, ztjjReferer)
	if err != nil {
		return nil, err
	}
	return parseZTJJ(body)
}

// fetchZTJJStage 拉取某类别(tt)、某周期(st) 的热门主题涨幅列表（按该周期涨幅降序）。
func fetchZTJJStage(ctx context.Context, tt, st string) ([]ztjjItem, error) {
	return fetchZTJJ(ctx, tt, "syl", st)
}

// stageField 取某周期对应的原始值字段。
func stageField(it ztjjItem, st string) json.RawMessage {
	switch st {
	case "W":
		return it.W
	case "M":
		return it.M
	case "Q":
		return it.Q
	case "SY":
		return it.SY
	default:
		return it.D
	}
}

// FetchSectors 拉取热门主题（对齐天天基金 ztjj 热门主题）。
// kind：all（全部）/ industry（行业）/ concept（概念）。
// 数据源 api.fund.eastmoney.com/ztjj/GetZTJJListNew（push2 行情接口对桌面端 Go 请求会被反爬静默断连，故改用此可达接口）。
// 一次类别需多次请求拿到今日(D)/近1周(W)/近1月(M)/近3月(Q)/今年来(SY) 五档涨幅并按主题代码合并。
func FetchSectors(ctx context.Context, kind string) ([]model.SectorItem, error) {
	tt, ok := ztjjCategory[kind]
	if !ok {
		kind = "all"
		tt = ztjjCategory["all"]
	}

	// 五档周期：D 今日、W 近1周、M 近1月、Q 近3月、SY 今年来；首档（今日）失败则整体失败，其余档失败仅该档为 0。
	stages := []string{"D", "W", "M", "Q", "SY"}
	byCode := make(map[string]*model.SectorItem)
	order := make([]string, 0, 200)

	for i, st := range stages {
		items, err := fetchZTJJStage(ctx, tt, st)
		if err != nil {
			logger.Warn("热门主题请求失败 kind=%s st=%s err=%v", kind, st, err)
			if i == 0 {
				return nil, fmt.Errorf("拉取热门主题失败: %w", err)
			}
			continue
		}
		for _, it := range items {
			if it.Code == "" {
				continue
			}
			si, exists := byCode[it.Code]
			if !exists {
				si = &model.SectorItem{Code: it.Code, Name: it.Name, Kind: kind}
				byCode[it.Code] = si
				order = append(order, it.Code)
			}
			v := rawNumber(stageField(it, st))
			switch st {
			case "W":
				si.Week = v
			case "M":
				si.Month = v
			case "Q":
				si.Month3 = v
			case "SY":
				si.Ytd = v
			default:
				si.ChangePercent = v
			}
		}
	}

	out := make([]model.SectorItem, 0, len(order))
	for _, code := range order {
		out = append(out, *byCode[code])
	}
	return out, nil
}

// FetchSectorMoneyFlow 拉取热门主题「按资金流入」排行（按所选周期主力净流入降序）。
// kind：all（全部）/ industry（行业）/ concept（概念）；
// stage：now 实时 / week 近1周 / month 近1月 / m3 近3月（对应 st=FLOW/FLOW_W/FLOW_M/FLOW_Q）。
// 数据源与「按涨幅」同为天天基金 ztjj GetZTJJListNew，仅 dt=zjlr，
// 因此返回的主题代码与涨幅视图一致（BK000xxx），点击可直接进入主题相关基金列表。
func FetchSectorMoneyFlow(ctx context.Context, kind, stage string) ([]model.SectorItem, error) {
	tt, ok := ztjjCategory[kind]
	if !ok {
		kind = "all"
		tt = ztjjCategory["all"]
	}
	st, ok := ztjjFlowStage[stage]
	if !ok {
		st = "FLOW"
	}
	items, err := fetchZTJJ(ctx, tt, "zjlr", st)
	if err != nil {
		return nil, fmt.Errorf("拉取热门主题资金流入失败: %w", err)
	}
	out := make([]model.SectorItem, 0, len(items))
	for _, it := range items {
		if it.Code == "" {
			continue
		}
		out = append(out, model.SectorItem{
			Code:   it.Code,
			Name:   it.Name,
			Inflow: rawNumber(flowField(it, st)),
			Kind:   kind,
		})
	}
	// 非实时周期（FLOW_M/FLOW_Q）接口返回顺序不稳定，统一按净流入降序。
	sort.SliceStable(out, func(i, j int) bool { return out[i].Inflow > out[j].Inflow })
	return out, nil
}

// rawThemeDetail GetBKDetailInfoNew 返回的主题各周期涨幅与同类排名（字段名固定为数字/字符串，用 RawMessage 容错）。
type rawThemeDetail struct {
	SecCode string          `json:"SEC_CODE"`
	SecName string          `json:"SEC_NAME"`
	D       json.RawMessage `json:"D"`  // 今日涨幅（%，无排名）
	W       json.RawMessage `json:"W"`  // 近1周
	M       json.RawMessage `json:"M"`  // 近1月
	Q       json.RawMessage `json:"Q"`  // 近3月
	Y       json.RawMessage `json:"Y"`  // 近1年
	SY      json.RawMessage `json:"SY"` // 今年来
	RankW   json.RawMessage `json:"RANKW"`
	RankM   json.RawMessage `json:"RANKM"`
	RankQ   json.RawMessage `json:"RANKQ"`
	RankY   json.RawMessage `json:"RANKY"`
	RankSY  json.RawMessage `json:"RANKSY"`
	WSC     json.RawMessage `json:"WSC"`  // 近1周同类总数
	MSC     json.RawMessage `json:"MSC"`  // 近1月同类总数
	QSC     json.RawMessage `json:"QSC"`  // 近3月同类总数
	YSC     json.RawMessage `json:"YSC"`  // 近1年同类总数
	SYSC    json.RawMessage `json:"SYSC"` // 今年来同类总数
}

// rawThemeDetailResponse GetBKDetailInfoNew 返回结构。
type rawThemeDetailResponse struct {
	Data    *rawThemeDetail `json:"Data"`
	ErrCode int             `json:"ErrCode"`
}

// parseThemeDetail 解析主题详情（各周期涨幅 + 同类排名）。
func parseThemeDetail(body string) (*model.ThemeDetail, error) {
	body = strings.TrimSpace(body)
	if !strings.HasPrefix(body, "{") {
		if j, err := datasource.StripJSONP(body); err == nil {
			body = j
		}
	}
	var raw rawThemeDetailResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析主题详情 JSON 失败: %w", err)
	}
	if raw.Data == nil {
		return nil, fmt.Errorf("主题详情响应为空")
	}
	d := raw.Data
	return &model.ThemeDetail{
		Code:        d.SecCode,
		Name:        d.SecName,
		Day:         rawNumber(d.D),
		Week:        rawNumber(d.W),
		Month:       rawNumber(d.M),
		Month3:      rawNumber(d.Q),
		Year1:       rawNumber(d.Y),
		Ytd:         rawNumber(d.SY),
		WeekRank:    int(rawNumber(d.RankW)),
		MonthRank:   int(rawNumber(d.RankM)),
		Month3Rank:  int(rawNumber(d.RankQ)),
		Year1Rank:   int(rawNumber(d.RankY)),
		YtdRank:     int(rawNumber(d.RankSY)),
		WeekCount:   int(rawNumber(d.WSC)),
		MonthCount:  int(rawNumber(d.MSC)),
		Month3Count: int(rawNumber(d.QSC)),
		Year1Count:  int(rawNumber(d.YSC)),
		YtdCount:    int(rawNumber(d.SYSC)),
	}, nil
}

// FetchThemeDetail 拉取主题（板块）自身各周期涨幅与同类排名（天天基金 ztjj GetBKDetailInfoNew）。
// bkCode 形如 BK000651（光模块）；用于主题相关基金页顶部展示该主题近期表现。
func FetchThemeDetail(ctx context.Context, bkCode string) (*model.ThemeDetail, error) {
	url := fmt.Sprintf(
		"https://api.fund.eastmoney.com/ZTJJ/GetBKDetailInfoNew?tp=%s&_=%d",
		bkCode, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, ztjjReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取主题详情失败: %w", err)
	}
	return parseThemeDetail(body)
}

// themeFundSortKeys GetBKRelTopicFundNew 合法排序键白名单。
var themeFundSortKeys = map[string]bool{
	"RZDF": true, "SYL_Z": true, "SYL_Y": true, "SYL_3Y": true,
	"SYL_6Y": true, "SYL_1N": true, "SYL_JN": true,
}

// rawThemeFund GetBKRelTopicFundNew 单条相关基金（字段多为数字/可能为 null，用 RawMessage 容错）。
type rawThemeFund struct {
	FCODE     string          `json:"FCODE"`
	SHORTNAME string          `json:"SHORTNAME"`
	SYRQ      string          `json:"SYRQ"`
	DWJZ      json.RawMessage `json:"DWJZ"`
	RZDF      json.RawMessage `json:"RZDF"`
	SYLZ      json.RawMessage `json:"SYL_Z"`
	SYLY      json.RawMessage `json:"SYL_Y"`
	SYL3Y     json.RawMessage `json:"SYL_3Y"`
	SYL6Y     json.RawMessage `json:"SYL_6Y"`
	SYL1N     json.RawMessage `json:"SYL_1N"`
	SYL2N     json.RawMessage `json:"SYL_2N"`
	SYL3N     json.RawMessage `json:"SYL_3N"`
	SYLJN     json.RawMessage `json:"SYL_JN"`
	SYLLN     json.RawMessage `json:"SYL_LN"`
}

// rawThemeFundsResponse GetBKRelTopicFundNew 返回结构。
type rawThemeFundsResponse struct {
	Data       []rawThemeFund `json:"Data"`
	TotalCount int            `json:"TotalCount"`
	ErrCode    int            `json:"ErrCode"`
}

// parseThemeFunds 解析主题相关基金（复用 RankItem/RankPage 模型）。
func parseThemeFunds(body string) (*model.RankPage, error) {
	body = strings.TrimSpace(body)
	if !strings.HasPrefix(body, "{") {
		if j, err := datasource.StripJSONP(body); err == nil {
			body = j
		}
	}
	var raw rawThemeFundsResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析主题基金 JSON 失败: %w", err)
	}
	page := &model.RankPage{Total: raw.TotalCount, Items: make([]model.RankItem, 0, len(raw.Data))}
	for _, d := range raw.Data {
		page.Items = append(page.Items, model.RankItem{
			Code:        d.FCODE,
			Name:        d.SHORTNAME,
			Date:        d.SYRQ,
			Nav:         rawNumber(d.DWJZ),
			DayGrowth:   rawNumber(d.RZDF),
			WeekGrowth:  rawNumber(d.SYLZ),
			MonthGrowth: rawNumber(d.SYLY),
			Month3:      rawNumber(d.SYL3Y),
			Month6:      rawNumber(d.SYL6Y),
			Year1:       rawNumber(d.SYL1N),
			Year2:       rawNumber(d.SYL2N),
			Year3:       rawNumber(d.SYL3N),
			Ytd:         rawNumber(d.SYLJN),
			SinceStart:  rawNumber(d.SYLLN),
		})
	}
	return page, nil
}

// FetchThemeFunds 按主题（板块）代码拉取相关基金（天天基金 ztjj GetBKRelTopicFundNew）。
// bkCode 形如 BK000641（CPO）；sortKey 见 themeFundSortKeys；sortType：desc/asc。
func FetchThemeFunds(ctx context.Context, bkCode, sortKey, sortType string, pageIndex, pageSize int) (*model.RankPage, error) {
	if !themeFundSortKeys[sortKey] {
		sortKey = "SYL_1N"
	}
	st := "DESC"
	if strings.EqualFold(sortType, "asc") {
		st = "ASC"
	}
	if pageIndex <= 0 {
		pageIndex = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	url := fmt.Sprintf(
		"https://api.fund.eastmoney.com/ZTJJ/GetBKRelTopicFundNew?tp=%s&isbuy=1&sort=%s&sorttype=%s&pageindex=%d&pagesize=%d&_=%d",
		bkCode, sortKey, st, pageIndex, pageSize, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, ztjjReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取主题基金列表失败: %w", err)
	}
	return parseThemeFunds(body)
}
