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

// fundTypeToNum 将前端基金类型映射为移动端排行接口（FundMNRank）的 FundType 数字编码。
// 0 全部 / 25 股票 / 27 混合 / 31 债券 / 26 指数 / 6 QDII / 15 FOF。
var fundTypeToNum = map[string]string{
	"all": "0", "gp": "25", "hh": "27", "zq": "31", "zs": "26", "qdii": "6", "fof": "15",
}

// sortKeyToColumn 将前端排序键映射为 FundMNRank 的 SortColumn。
// rzdf 日涨幅 / zzf 近1周 / 1yzf 近1月 / 3yzf 近3月 / 6yzf 近6月 / 1nzf 近1年 / jnzf 今年来 / 3nzf 近3年。
var sortKeyToColumn = map[string]string{
	"rzdf": "RZDF", "zzf": "SYL_Z", "1yzf": "SYL_Y", "3yzf": "SYL_3Y",
	"6yzf": "SYL_6Y", "1nzf": "SYL_1N", "jnzf": "SYL_JN", "3nzf": "SYL_3N",
}

// rankPageSizeMax FundMNRank 单页最多返回 30 条（接口硬限制，传更大也只返回 30）。
const rankPageSizeMax = 30

// parseFloatOr0 排行字段可能为空字符串或 "--"，统一解析为 0。
func parseFloatOr0(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

// rawRankResponse 移动端基金排行（FundMNRank）返回结构。
// 该接口原生包含规模（ENDNAV）与各周期收益，省去额外的规模补全请求。
type rawRankResponse struct {
	Datas []struct {
		FCODE     string `json:"FCODE"`     // 基金代码
		SHORTNAME string `json:"SHORTNAME"` // 基金简称
		FSRQ      string `json:"FSRQ"`      // 净值日期
		DWJZ      string `json:"DWJZ"`      // 单位净值
		LJJZ      string `json:"LJJZ"`      // 累计净值
		RZDF      string `json:"RZDF"`      // 日增长率
		SYLZ      string `json:"SYL_Z"`     // 近1周
		SYLY      string `json:"SYL_Y"`     // 近1月
		SYL3Y     string `json:"SYL_3Y"`    // 近3月
		SYL6Y     string `json:"SYL_6Y"`    // 近6月
		SYL1N     string `json:"SYL_1N"`    // 近1年
		SYL2N     string `json:"SYL_2N"`    // 近2年
		SYL3N     string `json:"SYL_3N"`    // 近3年
		SYLJN     string `json:"SYL_JN"`    // 今年来
		SYLLN     string `json:"SYL_LN"`    // 成立来
		ENDNAV    string `json:"ENDNAV"`    // 最新规模（元）
	} `json:"Datas"`
	ErrCode    int `json:"ErrCode"`
	TotalCount int `json:"TotalCount"`
}

// parseRanking 解析 FundMNRank 返回的 JSON。
func parseRanking(body string) (*model.RankPage, error) {
	var raw rawRankResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析基金排行 JSON 失败: %w", err)
	}
	page := &model.RankPage{Total: raw.TotalCount, Items: make([]model.RankItem, 0, len(raw.Datas))}
	for _, d := range raw.Datas {
		page.Items = append(page.Items, model.RankItem{
			Code:        d.FCODE,
			Name:        d.SHORTNAME,
			Date:        d.FSRQ,
			Nav:         parseFloatOr0(d.DWJZ),
			AccNav:      parseFloatOr0(d.LJJZ),
			DayGrowth:   parseFloatOr0(d.RZDF),
			WeekGrowth:  parseFloatOr0(d.SYLZ),
			MonthGrowth: parseFloatOr0(d.SYLY),
			Month3:      parseFloatOr0(d.SYL3Y),
			Month6:      parseFloatOr0(d.SYL6Y),
			Year1:       parseFloatOr0(d.SYL1N),
			Year2:       parseFloatOr0(d.SYL2N),
			Year3:       parseFloatOr0(d.SYL3N),
			Ytd:         parseFloatOr0(d.SYLJN),
			SinceStart:  parseFloatOr0(d.SYLLN),
			Scale:       parseFloatOr0(d.ENDNAV),
		})
	}
	return page, nil
}

// FetchRanking 拉取基金排行（移动端 FundMNRank，原生含规模与各周期收益）。
// fundType：all/gp/hh/zq/zs/qdii/fof；sortKey：rzdf/zzf/1yzf/3yzf/6yzf/1nzf/jnzf/3nzf；sortType：desc/asc。
func FetchRanking(ctx context.Context, fundType, sortKey, sortType string, pageIndex, pageSize int) (*model.RankPage, error) {
	ftNum, ok := fundTypeToNum[fundType]
	if !ok {
		ftNum = "0"
	}
	sortColumn, ok := sortKeyToColumn[sortKey]
	if !ok {
		sortColumn = "RZDF"
	}
	if sortType != "asc" {
		sortType = "desc"
	}
	if pageIndex <= 0 {
		pageIndex = 1
	}
	if pageSize <= 0 || pageSize > rankPageSizeMax {
		pageSize = rankPageSizeMax
	}
	url := fmt.Sprintf(
		"https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank?FundType=%s&SortColumn=%s&Sort=%s&pageIndex=%d&pageSize=%d&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=minifund",
		ftNum, sortColumn, sortType, pageIndex, pageSize)
	body, err := datasource.FetchText(ctx, url, fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取基金排行失败: %w", err)
	}
	return parseRanking(body)
}
