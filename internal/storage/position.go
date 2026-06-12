package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"minifund/internal/model"
)

// GetPosition 查询某基金持仓，不存在返回 nil。
func (s *Store) GetPosition(code string) (*model.Position, error) {
	var p model.Position
	err := s.db.QueryRow("SELECT code, shares, cost_price, updated_at FROM position WHERE code = ?", code).
		Scan(&p.Code, &p.Shares, &p.CostPrice, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询持仓失败: %w", err)
	}
	return &p, nil
}

// ListPositions 返回全部持仓。
func (s *Store) ListPositions() ([]model.Position, error) {
	rows, err := s.db.Query("SELECT code, shares, cost_price, updated_at FROM position")
	if err != nil {
		return nil, fmt.Errorf("查询持仓列表失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.Position, 0, 16)
	for rows.Next() {
		var p model.Position
		if err := rows.Scan(&p.Code, &p.Shares, &p.CostPrice, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("读取持仓失败: %w", err)
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// UpsertPosition 新增或更新持仓。
func (s *Store) UpsertPosition(code string, shares, costPrice float64) error {
	_, err := s.db.Exec(`INSERT INTO position (code, shares, cost_price, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET shares = excluded.shares, cost_price = excluded.cost_price, updated_at = excluded.updated_at`,
		code, shares, costPrice, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("保存持仓失败: %w", err)
	}
	return nil
}

// DeletePosition 删除持仓。
func (s *Store) DeletePosition(code string) error {
	_, err := s.db.Exec("DELETE FROM position WHERE code = ?", code)
	if err != nil {
		return fmt.Errorf("删除持仓失败: %w", err)
	}
	return nil
}

// SaveDailyProfit 净值确认后落库当日收益记录（供收益日历使用）。
func (s *Store) SaveDailyProfit(code, date string, nav, growth, profit float64) error {
	_, err := s.db.Exec(`INSERT INTO daily_profit (code, date, nav, growth, profit) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(code, date) DO UPDATE SET nav = excluded.nav, growth = excluded.growth, profit = excluded.profit`,
		code, date, nav, growth, profit)
	if err != nil {
		return fmt.Errorf("保存当日收益失败: %w", err)
	}
	return nil
}

// HasDailyProfit 判断某基金某日净值是否已确认落库。
func (s *Store) HasDailyProfit(code, date string) (bool, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(1) FROM daily_profit WHERE code = ? AND date = ?", code, date).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("查询净值确认状态失败: %w", err)
	}
	return n > 0, nil
}
