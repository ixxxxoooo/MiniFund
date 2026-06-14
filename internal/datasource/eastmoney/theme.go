package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// rawSearchResponse 东财搜索接口（FundSearchAPI）返回结构，仅取所属主题（ZTJJInfo）。
type rawSearchResponse struct {
	Datas []struct {
		CODE     string `json:"CODE"`
		ZTJJInfo []struct {
			TTYPE     string `json:"TTYPE"`     // 主题代码 BKxxxxxx
			TTYPENAME string `json:"TTYPENAME"` // 主题名称
		} `json:"ZTJJInfo"`
	} `json:"Datas"`
}

// FetchFundThemes 拉取某基金所属的主题/概念标签（东财搜索接口 ZTJJInfo）。
// 主题变动缓慢，调用方应做长 TTL 缓存，避免逐基金高频请求。
func FetchFundThemes(ctx context.Context, code string) ([]model.FundTheme, error) {
	url := fmt.Sprintf(
		"https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=%s&pageindex=1&pagesize=5&_=%d",
		code, time.Now().UnixMilli())
	body, err := datasource.FetchText(ctx, url, fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取基金主题失败: %w", err)
	}
	var raw rawSearchResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析基金主题 JSON 失败: %w", err)
	}
	themes := []model.FundTheme{}
	for _, d := range raw.Datas {
		if d.CODE != code {
			continue
		}
		for _, z := range d.ZTJJInfo {
			if z.TTYPENAME == "" {
				continue
			}
			themes = append(themes, model.FundTheme{Code: z.TTYPE, Name: z.TTYPENAME})
		}
		break
	}
	return themes, nil
}

// rawPeriodResponse 阶段涨幅接口（FundMNPeriodIncrease）返回结构。
type rawPeriodResponse struct {
	Datas []struct {
		Title string `json:"title"` // 周期：Z/Y/3Y/6Y/1N/2N/3N/5N/JN/LN
		Syl   string `json:"syl"`   // 本基金涨跌幅（%）
		Avg   string `json:"avg"`   // 同类平均（%）
		Rank  string `json:"rank"`  // 同类排名
		Sc    string `json:"sc"`    // 同类数量
	} `json:"Datas"`
}

// FetchFundPeriodReturns 拉取基金阶段涨幅（近1周/近1月/近3月/近6月/近1/2/3/5年/今年来/成立来）。
func FetchFundPeriodReturns(ctx context.Context, code string) ([]model.PeriodReturn, error) {
	url := fmt.Sprintf(
		"https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease?FCODE=%s&RANGE=&deviceid=minifund&plat=Iphone&product=EFund&version=6.6.6",
		code)
	body, err := datasource.FetchText(ctx, url, fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取阶段涨幅失败: %w", err)
	}
	var raw rawPeriodResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析阶段涨幅 JSON 失败: %w", err)
	}
	out := make([]model.PeriodReturn, 0, len(raw.Datas))
	for _, d := range raw.Datas {
		pr := model.PeriodReturn{Period: d.Title, Value: parseFloatOr0(d.Syl), Avg: parseFloatOr0(d.Avg)}
		fmt.Sscanf(d.Rank, "%d", &pr.Rank)
		fmt.Sscanf(d.Sc, "%d", &pr.Count)
		out = append(out, pr)
	}
	return out, nil
}
