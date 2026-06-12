package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// parseFundIndex 解析全量基金代码表脚本：var r = [["代码","拼音缩写","名称","类型","全拼"],...];
func parseFundIndex(script string) ([]model.FundIndexItem, error) {
	raw, ok := datasource.ExtractJSVar(script, "r")
	if !ok {
		// 兜底：部分镜像不带 var 前缀
		trimmed := strings.TrimSpace(script)
		if !strings.HasPrefix(trimmed, "[") {
			return nil, fmt.Errorf("代码表响应格式异常")
		}
		raw = strings.TrimSuffix(trimmed, ";")
	}
	var rows [][]string
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return nil, fmt.Errorf("解析代码表 JSON 失败: %w", err)
	}
	items := make([]model.FundIndexItem, 0, len(rows))
	for _, row := range rows {
		if len(row) < 5 {
			continue
		}
		items = append(items, model.FundIndexItem{
			Code:       row[0],
			PinyinAbbr: row[1],
			Name:       row[2],
			Type:       row[3],
			PinyinFull: row[4],
		})
	}
	return items, nil
}

// FetchFundIndex 拉取全量基金代码表（约 2 万条，每周更新一次即可）。
func FetchFundIndex(ctx context.Context) ([]model.FundIndexItem, error) {
	body, err := datasource.FetchText(ctx, "https://fund.eastmoney.com/js/fundcode_search.js", fundReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取基金代码表失败: %w", err)
	}
	return parseFundIndex(body)
}
