package storage

import (
	"fmt"
	"strings"
	"time"
)

// ThemeCacheRow 基金主题缓存行（themes 为 []model.FundTheme 的 JSON 串）。
type ThemeCacheRow struct {
	Themes    string
	UpdatedAt int64
}

// GetThemeCaches 批量读取基金主题缓存（code → 缓存行），未命中的 code 不在返回 map 中。
func (s *Store) GetThemeCaches(codes []string) (map[string]ThemeCacheRow, error) {
	out := make(map[string]ThemeCacheRow, len(codes))
	if len(codes) == 0 {
		return out, nil
	}
	placeholders := strings.Repeat("?,", len(codes))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(codes))
	for i, c := range codes {
		args[i] = c
	}
	rows, err := s.db.Query("SELECT code, themes, updated_at FROM fund_theme WHERE code IN ("+placeholders+")", args...)
	if err != nil {
		return nil, fmt.Errorf("查询主题缓存失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var code string
		var row ThemeCacheRow
		if err := rows.Scan(&code, &row.Themes, &row.UpdatedAt); err != nil {
			return nil, fmt.Errorf("读取主题缓存失败: %w", err)
		}
		out[code] = row
	}
	return out, rows.Err()
}

// SaveThemeCache 写入/更新某基金的主题缓存（themesJSON 即使为空数组也写入，避免对无主题基金反复请求）。
func (s *Store) SaveThemeCache(code, themesJSON string) error {
	_, err := s.db.Exec(
		"INSERT OR REPLACE INTO fund_theme (code, themes, updated_at) VALUES (?, ?, ?)",
		code, themesJSON, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("写入主题缓存失败: %w", err)
	}
	return nil
}
