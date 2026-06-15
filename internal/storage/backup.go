package storage

import (
	"fmt"
	"time"

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

// ReplaceWatchlistData 在单个事务中整体替换自选/分组/持仓流水/收益历史/定投计划（数据导入恢复用）。
// 分组按原 id 重建，保证「条目→分组」映射不丢失；持仓由流水重算回写，不触碰基金代码表与各类缓存。
// 兼容旧版备份：当无流水但有持仓快照时，按持仓回填为一笔买入流水，保证模型一致。
func (s *Store) ReplaceWatchlistData(
	groups []model.WatchGroup,
	items []model.WatchItem,
	positions []model.Position,
	profits []model.DailyProfit,
	transactions []model.PositionTxn,
	plans []model.DCAPlan,
) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启导入事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 清空旧数据
	for _, table := range []string{"watch_item", "watch_group", "position", "daily_profit", "position_txn", "dca_plan"} {
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
	for _, p := range profits {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO daily_profit (code, date, nav, growth, profit) VALUES (?, ?, ?, ?, ?)`,
			p.Code, p.Date, p.Nav, p.Growth, p.Profit); err != nil {
			return fmt.Errorf("写入收益历史失败: %w", err)
		}
	}

	// 旧版备份无流水时，把持仓快照回填为一笔买入流水
	txns := transactions
	if len(txns) == 0 {
		for _, p := range positions {
			txns = append(txns, model.PositionTxn{
				Code: p.Code, Date: time.Unix(p.UpdatedAt, 0).Format("2006-01-02"),
				Kind: model.TxnKindBuy, Shares: p.Shares, Price: p.CostPrice,
				Amount: p.Shares * p.CostPrice, Source: model.TxnSourceManual,
				Note: "迁移自原持仓", CreatedAt: p.UpdatedAt,
			})
		}
	}
	codeSet := map[string]struct{}{}
	for _, t := range txns {
		if _, err := tx.Exec(`INSERT INTO position_txn (code, date, kind, shares, price, amount, source, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			t.Code, t.Date, t.Kind, t.Shares, t.Price, t.Amount, t.Source, t.Note, t.CreatedAt); err != nil {
			return fmt.Errorf("写入交易流水失败: %w", err)
		}
		codeSet[t.Code] = struct{}{}
	}
	for code := range codeSet {
		if err := recomputePositionTx(tx, code); err != nil {
			return err
		}
	}

	for _, p := range plans {
		if _, err := tx.Exec(`INSERT INTO dca_plan (code, freq, day, amount, auto_record, enabled, next_run, last_run, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.Code, p.Freq, p.Day, p.Amount, boolToInt(p.AutoRecord), boolToInt(p.Enabled), p.NextRun, p.LastRun, p.CreatedAt); err != nil {
			return fmt.Errorf("写入定投计划失败: %w", err)
		}
	}

	return tx.Commit()
}
