package storage

import (
	"fmt"
	"strings"
	"time"

	"minifund/internal/model"
)

// ReplaceFundIndex 全量替换基金代码表（每周更新一次）。
func (s *Store) ReplaceFundIndex(items []model.FundIndexItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec("DELETE FROM fund_index"); err != nil {
		return fmt.Errorf("清空基金代码表失败: %w", err)
	}
	stmt, err := tx.Prepare("INSERT INTO fund_index (code, name, type, pinyin_abbr, pinyin_full, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("准备插入语句失败: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	now := time.Now().Unix()
	for _, it := range items {
		if _, err := stmt.Exec(it.Code, it.Name, it.Type, strings.ToUpper(it.PinyinAbbr), strings.ToUpper(it.PinyinFull), now); err != nil {
			return fmt.Errorf("写入基金代码 %s 失败: %w", it.Code, err)
		}
	}
	return tx.Commit()
}

// FundIndexUpdatedAt 返回基金代码表最近更新时间（Unix 秒），空表返回 0。
func (s *Store) FundIndexUpdatedAt() (int64, error) {
	var ts int64
	err := s.db.QueryRow("SELECT COALESCE(MAX(updated_at), 0) FROM fund_index").Scan(&ts)
	if err != nil {
		return 0, fmt.Errorf("查询代码表更新时间失败: %w", err)
	}
	return ts, nil
}

// SearchFunds 本地模糊搜索：代码前缀 / 名称包含 / 拼音首字母前缀 / 全拼包含。
func (s *Store) SearchFunds(keyword string, limit int) ([]model.FundIndexItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	kw := strings.TrimSpace(keyword)
	if kw == "" {
		return []model.FundIndexItem{}, nil
	}
	upper := strings.ToUpper(kw)
	rows, err := s.db.Query(`
		SELECT code, name, type, pinyin_abbr, pinyin_full FROM fund_index
		WHERE code LIKE ? OR name LIKE ? OR pinyin_abbr LIKE ? OR pinyin_full LIKE ?
		ORDER BY
			CASE WHEN code = ? THEN 0 WHEN code LIKE ? THEN 1 WHEN pinyin_abbr LIKE ? THEN 2 ELSE 3 END,
			code
		LIMIT ?`,
		kw+"%", "%"+kw+"%", upper+"%", "%"+upper+"%",
		kw, kw+"%", upper+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("搜索基金失败: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := make([]model.FundIndexItem, 0, limit)
	for rows.Next() {
		var it model.FundIndexItem
		if err := rows.Scan(&it.Code, &it.Name, &it.Type, &it.PinyinAbbr, &it.PinyinFull); err != nil {
			return nil, fmt.Errorf("读取搜索结果失败: %w", err)
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// GetFundIndexItem 按代码取基金基础信息。
func (s *Store) GetFundIndexItem(code string) (*model.FundIndexItem, error) {
	var it model.FundIndexItem
	err := s.db.QueryRow("SELECT code, name, type, pinyin_abbr, pinyin_full FROM fund_index WHERE code = ?", code).
		Scan(&it.Code, &it.Name, &it.Type, &it.PinyinAbbr, &it.PinyinFull)
	if err != nil {
		return nil, err
	}
	return &it, nil
}
