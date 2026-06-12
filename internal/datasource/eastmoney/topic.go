package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

const topicReferer = "https://fund.eastmoney.com/ztjj/"

// topicSortKeys 主题基金列表合法排序键（服务端排序白名单）。
var topicSortKeys = map[string]bool{
	"NAVCHGRT": true, // 日涨幅
	"SYL_Z":    true, // 周涨幅
	"SYL_Y":    true, // 月涨幅
	"SYL_3Y":   true, // 近 3 月
	"SYL_6Y":   true, // 近 6 月
	"SYL_1N":   true, // 近 1 年
	"SYL_JN":   true, // 今年来
}

// stripJSVarPrefix 去掉 `var result=` 前缀，返回 JSON 体。
func stripJSVarPrefix(body string) (string, error) {
	idx := strings.Index(body, "=")
	if !strings.HasPrefix(strings.TrimSpace(body), "var ") || idx < 0 {
		// 部分情况直接返回 JSON
		trimmed := strings.TrimSpace(body)
		if strings.HasPrefix(trimmed, "{") {
			return trimmed, nil
		}
		return "", fmt.Errorf("主题接口响应格式异常")
	}
	return strings.TrimSpace(body[idx+1:]), nil
}

// rawTopicListResponse 主题列表（dt=11）返回结构：Datas 为 "id,名称,近1年涨幅" 字符串数组。
type rawTopicListResponse struct {
	Datas      []string `json:"Datas"`
	TotalCount string   `json:"TotalCount"`
}

// parseTopics 解析主题列表。
func parseTopics(body string) ([]model.TopicItem, error) {
	jsonBody, err := stripJSVarPrefix(body)
	if err != nil {
		return nil, err
	}
	var raw rawTopicListResponse
	if err := json.Unmarshal([]byte(jsonBody), &raw); err != nil {
		return nil, fmt.Errorf("解析主题列表 JSON 失败: %w", err)
	}
	items := make([]model.TopicItem, 0, len(raw.Datas))
	for _, row := range raw.Datas {
		f := strings.Split(row, ",")
		if len(f) < 3 {
			continue
		}
		it := model.TopicItem{ID: f[0], Name: f[1]}
		it.Year1Growth, _ = strconv.ParseFloat(f[2], 64)
		items = append(items, it)
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("主题列表为空")
	}
	return items, nil
}

// FetchTopics 拉取全部基金主题列表（约 150 个，含近 1 年涨幅）。
func FetchTopics(ctx context.Context) ([]model.TopicItem, error) {
	url := "https://fund.eastmoney.com/api/FundTopicInterface.ashx?dt=11&sort=CHANGERATE&sorttype=desc&pageindex=1&pagesize=300"
	body, err := datasource.FetchText(ctx, url, topicReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取主题列表失败: %w", err)
	}
	return parseTopics(body)
}

// rawTopicFundsResponse 主题基金列表（dt=10）返回结构。
type rawTopicFundsResponse struct {
	Datas []struct {
		FCODE     string `json:"FCODE"`
		SHORTNAME string `json:"SHORTNAME"`
		PDATE     string `json:"PDATE"`    // 净值日期
		NAV       string `json:"NAV"`      // 单位净值
		NAVCHGRT  string `json:"NAVCHGRT"` // 日涨幅
		SYLZ      string `json:"SYL_Z"`    // 周涨幅
		SYLY      string `json:"SYL_Y"`    // 月涨幅
		SYL3Y     string `json:"SYL_3Y"`   // 近 3 月
		SYL6Y     string `json:"SYL_6Y"`   // 近 6 月
		SYL1N     string `json:"SYL_1N"`   // 近 1 年
		SYLJN     string `json:"SYL_JN"`   // 今年来
	} `json:"Datas"`
	TotalCount int `json:"TotalCount"`
	ErrCode    int `json:"ErrCode"`
}

// parseTopicFunds 解析主题基金列表（复用 RankItem/RankPage 模型）。
func parseTopicFunds(body string) (*model.RankPage, error) {
	jsonBody, err := stripJSVarPrefix(body)
	if err != nil {
		return nil, err
	}
	var raw rawTopicFundsResponse
	if err := json.Unmarshal([]byte(jsonBody), &raw); err != nil {
		return nil, fmt.Errorf("解析主题基金 JSON 失败: %w", err)
	}
	if raw.ErrCode != 0 {
		return nil, fmt.Errorf("主题基金接口返回错误码: %d", raw.ErrCode)
	}
	page := &model.RankPage{Total: raw.TotalCount, Items: make([]model.RankItem, 0, len(raw.Datas))}
	for _, d := range raw.Datas {
		item := model.RankItem{
			Code: d.FCODE, Name: d.SHORTNAME, Date: d.PDATE,
			Nav:         parseFloatOr0(d.NAV),
			DayGrowth:   parseFloatOr0(d.NAVCHGRT),
			WeekGrowth:  parseFloatOr0(d.SYLZ),
			MonthGrowth: parseFloatOr0(d.SYLY),
			Month3:      parseFloatOr0(d.SYL3Y),
			Month6:      parseFloatOr0(d.SYL6Y),
			Year1:       parseFloatOr0(d.SYL1N),
			Ytd:         parseFloatOr0(d.SYLJN),
		}
		page.Items = append(page.Items, item)
	}
	return page, nil
}

// FetchTopicFunds 拉取某主题下的基金列表（服务端排序 + 分页）。
// sortKey 见 topicSortKeys；sortType：desc / asc。
func FetchTopicFunds(ctx context.Context, topicID, sortKey, sortType string, pageIndex, pageSize int) (*model.RankPage, error) {
	if !topicSortKeys[sortKey] {
		sortKey = "SYL_1N"
	}
	if sortType != "asc" {
		sortType = "desc"
	}
	if pageIndex <= 0 {
		pageIndex = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	url := fmt.Sprintf(
		"https://fund.eastmoney.com/api/FundTopicInterface.ashx?dt=10&tp=%s&sort=%s&sorttype=%s&pageindex=%d&pagesize=%d",
		topicID, sortKey, sortType, pageIndex, pageSize)
	body, err := datasource.FetchText(ctx, url, topicReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取主题基金列表失败: %w", err)
	}
	return parseTopicFunds(body)
}
