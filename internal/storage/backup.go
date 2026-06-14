package storage

import (
	"fmt"

	"minifund/internal/model"
)

// ListAllRawItems 返回全部分组的原始自选条目（不去重、保留各自 group_id），供数据备份导出。
func (s *Store) ListAllRawItems() ([]model.WatchItem, error) {
	rows, err := s.db.Query(`
		SELECT code, group_id, sort, pinned, created_at
		FROM watch_item ORDER BY group_id, sort, created_at`)
	if err != nil {
		return nil, fmt.Errorf("查询自选条目失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.WatchItem, 0, 32)
	for rows.Next() {
		var it model.WatchItem
		var pinned int
		if err := rows.Scan(&it.Code, &it.GroupID, &it.Sort, &pinned, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("读取自选条目失败: %w", err)
		}
		it.Pinned = pinned != 0
		items = append(items, it)
	}
	return items, rows.Err()
}

// ListAllDailyProfits 返回全部每日收益记录，供数据备份导出。
func (s *Store) ListAllDailyProfits() ([]model.DailyProfit, error) {
	rows, err := s.db.Query("SELECT code, date, nav, growth, profit FROM daily_profit ORDER BY date, code")
	if err != nil {
		return nil, fmt.Errorf("查询收益历史失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.DailyProfit, 0, 64)
	for rows.Next() {
		var p model.DailyProfit
		if err := rows.Scan(&p.Code, &p.Date, &p.Nav, &p.Growth, &p.Profit); err != nil {
			return nil, fmt.Errorf("读取收益历史失败: %w", err)
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// ReplaceWatchlistData 在单个事务中整体替换自选/分组/持仓/收益历史（数据导入恢复用）。
// 分组按原 id 重建，保证「条目→分组」映射不丢失；不触碰基金代码表与各类缓存。
func (s *Store) ReplaceWatchlistData(
	groups []model.WatchGroup,
	items []model.WatchItem,
	positions []model.Position,
	profits []model.DailyProfit,
) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启导入事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 清空旧数据
	for _, table := range []string{"watch_item", "watch_group", "position", "daily_profit"} {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			return fmt.Errorf("清空 %s 失败: %w", table, err)
		}
	}

	for _, g := range groups {
		if _, err := tx.Exec("INSERT INTO watch_group (id, name, sort) VALUES (?, ?, ?)", g.ID, g.Name, g.Sort); err != nil {
			return fmt.Errorf("写入分组失败: %w", err)
		}
	}
	for _, it := range items {
		pinned := 0
		if it.Pinned {
			pinned = 1
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO watch_item (code, group_id, sort, pinned, created_at) VALUES (?, ?, ?, ?, ?)`,
			it.Code, it.GroupID, it.Sort, pinned, it.CreatedAt); err != nil {
			return fmt.Errorf("写入自选条目失败: %w", err)
		}
	}
	for _, p := range positions {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO position (code, shares, cost_price, updated_at) VALUES (?, ?, ?, ?)`,
			p.Code, p.Shares, p.CostPrice, p.UpdatedAt); err != nil {
			return fmt.Errorf("写入持仓失败: %w", err)
		}
	}
	for _, p := range profits {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO daily_profit (code, date, nav, growth, profit) VALUES (?, ?, ?, ?, ?)`,
			p.Code, p.Date, p.Nav, p.Growth, p.Profit); err != nil {
			return fmt.Errorf("写入收益历史失败: %w", err)
		}
	}
	return tx.Commit()
}
