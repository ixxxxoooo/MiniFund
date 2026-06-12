package eastmoney

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 排行接口合法的基金类型与排序键（白名单校验，防止拼接异常参数）
var (
	validFundTypes = map[string]bool{"all": true, "gp": true, "hh": true, "zq": true, "zs": true, "qdii": true, "fof": true}
	validSortKeys  = map[string]bool{"rzdf": true, "zzf": true, "1yzf": true, "3yzf": true, "6yzf": true, "1nzf": true, "jnzf": true, "3nzf": true}
)

var rankDataPattern = regexp.MustCompile(`(?s)var\s+rankData\s*=\s*\{datas:(\[.*?\]),allRecords:(\d+)`)

// parseFloatOr0 排行字段可能为空字符串，统一解析为 0。
func parseFloatOr0(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// parseRanking 解析 rankhandler 返回的 JS：var rankData = {datas:["代码,名称,拼音,日期,净值,累计净值,日,周,月,3月,6月,1年,2年,3年,今年,成立来,...",...],allRecords:N,...}
func parseRanking(body string) (*model.RankPage, error) {
	m := rankDataPattern.FindStringSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("排行数据格式异常")
	}
	total, _ := strconv.Atoi(m[2])

	// datas 是字符串数组，手动剥引号比完整 JSON 解析更稳（字段内不会出现引号）
	inner := strings.Trim(strings.TrimSpace(m[1]), "[]")
	page := &model.RankPage{Total: total, Items: []model.RankItem{}}
	if inner == "" {
		return page, nil
	}
	for _, quoted := range strings.Split(inner, `","`) {
		row := strings.Trim(quoted, `"`)
		f := strings.Split(row, ",")
		if len(f) < 15 {
			continue
		}
		item := model.RankItem{
			Code: f[0], Name: f[1], Date: f[3],
			Nav:         parseFloatOr0(f[4]),
			DayGrowth:   parseFloatOr0(f[6]),
			WeekGrowth:  parseFloatOr0(f[7]),
			MonthGrowth: parseFloatOr0(f[8]),
			Month3:      parseFloatOr0(f[9]),
			Month6:      parseFloatOr0(f[10]),
			Year1:       parseFloatOr0(f[11]),
			Ytd:         parseFloatOr0(f[14]),
		}
		page.Items = append(page.Items, item)
	}
	return page, nil
}

// FetchRanking 拉取基金排行。
// fundType：all/gp/hh/zq/zs/qdii/fof；sortKey：rzdf/zzf/1yzf/3yzf/6yzf/1nzf/jnzf/3nzf；sortType：desc/asc。
func FetchRanking(ctx context.Context, fundType, sortKey, sortType string, pageIndex, pageSize int) (*model.RankPage, error) {
	if !validFundTypes[fundType] {
		fundType = "all"
	}
	if !validSortKeys[sortKey] {
		sortKey = "rzdf"
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
		"https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=%s&rs=&gs=0&sc=%s&st=%s&qdii=&tabSubtype=,,,,,&pi=%d&pn=%d&dx=1",
		fundType, sortKey, sortType, pageIndex, pageSize)
	body, err := datasource.FetchText(ctx, url, "https://fund.eastmoney.com/data/fundranking.html")
	if err != nil {
		return nil, fmt.Errorf("拉取基金排行失败: %w", err)
	}
	return parseRanking(body)
}
