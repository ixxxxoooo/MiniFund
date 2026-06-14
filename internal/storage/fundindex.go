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
// offset 用于滚动加载更多。
func (s *Store) SearchFunds(keyword string, limit, offset int) ([]model.FundIndexItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
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
		LIMIT ? OFFSET ?`,
		kw+"%", "%"+kw+"%", upper+"%", "%"+upper+"%",
		kw, kw+"%", upper+"%", limit, offset)
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

// searchTypeLike 搜索页「基金类型筛选」键 → fund_index.type 的 LIKE 子串（与排行页类型一致）。
// all/空 不过滤；其余按类型名子串匹配（债券含「定开债券」，指数含「指数型」等）。
var searchTypeLike = map[string]string{
	"gp":   "%股票%",
	"hh":   "%混合%",
	"zq":   "%债券%",
	"zs":   "%指数%",
	"qdii": "%QDII%",
	"fof":  "%FOF%",
}

// SearchFundsPage 本地模糊搜索（分页）：在 SearchFunds 同款匹配规则基础上附带总数，
// 供搜索页按页展示。fundType 为类型筛选键（all/gp/hh/zq/zs/qdii/fof，空或 all 不过滤）。pageIndex 从 1 开始。
func (s *Store) SearchFundsPage(keyword, fundType string, pageIndex, pageSize int) (*model.FundIndexPage, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 20
	}
	if pageIndex < 1 {
		pageIndex = 1
	}
	page := &model.FundIndexPage{Items: []model.FundIndexItem{}, Total: 0}
	kw := strings.TrimSpace(keyword)
	if kw == "" {
		return page, nil
	}
	upper := strings.ToUpper(kw)
	// 匹配条件：代码前缀 / 名称包含 / 拼音首字母前缀 / 全拼包含（与 SearchFunds 保持一致）
	where := "WHERE (code LIKE ? OR name LIKE ? OR pinyin_abbr LIKE ? OR pinyin_full LIKE ?)"
	whereArgs := []any{kw + "%", "%" + kw + "%", upper + "%", "%" + upper + "%"}
	// 追加类型筛选
	if like, ok := searchTypeLike[fundType]; ok {
		where += " AND type LIKE ?"
		whereArgs = append(whereArgs, like)
	}

	if err := s.db.QueryRow("SELECT COUNT(*) FROM fund_index "+where, whereArgs...).Scan(&page.Total); err != nil {
		return nil, fmt.Errorf("统计搜索结果失败: %w", err)
	}
	if page.Total == 0 {
		return page, nil
	}

	offset := (pageIndex - 1) * pageSize
	args := append([]any{}, whereArgs...)
	args = append(args, kw, kw+"%", upper+"%", pageSize, offset)
	rows, err := s.db.Query(`
		SELECT code, name, type, pinyin_abbr, pinyin_full FROM fund_index `+where+`
		ORDER BY
			CASE WHEN code = ? THEN 0 WHEN code LIKE ? THEN 1 WHEN pinyin_abbr LIKE ? THEN 2 ELSE 3 END,
			code
		LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("搜索基金失败: %w", err)
	}
	defer func() { _ = rows.Close() }()

	page.Items = make([]model.FundIndexItem, 0, pageSize)
	for rows.Next() {
		var it model.FundIndexItem
		if err := rows.Scan(&it.Code, &it.Name, &it.Type, &it.PinyinAbbr, &it.PinyinFull); err != nil {
			return nil, fmt.Errorf("读取搜索结果失败: %w", err)
		}
		page.Items = append(page.Items, it)
	}
	return page, rows.Err()
}

// FundTypes 批量查询基金类型（code → type），用于调度器区分场内/场外。
func (s *Store) FundTypes(codes []string) (map[string]string, error) {
	out := make(map[string]string, len(codes))
	if len(codes) == 0 {
		return out, nil
	}
	placeholders := strings.Repeat("?,", len(codes))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(codes))
	for i, c := range codes {
		args[i] = c
	}
	rows, err := s.db.Query("SELECT code, type FROM fund_index WHERE code IN ("+placeholders+")", args...)
	if err != nil {
		return nil, fmt.Errorf("查询基金类型失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var code, typ string
		if err := rows.Scan(&code, &typ); err != nil {
			return nil, fmt.Errorf("读取基金类型失败: %w", err)
		}
		out[code] = typ
	}
	return out, rows.Err()
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
