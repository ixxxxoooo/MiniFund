package storage

import (
	"context"
	"database/sql"
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

// Snapshot 备份快照：自选分组、条目、持仓、交易流水、定投计划、每日收益的聚合。
type Snapshot struct {
	Groups       []model.WatchGroup
	Items        []model.WatchItem
	Positions    []model.Position
	Transactions []model.PositionTxn
	DCAPlans     []model.DCAPlan
	DailyProfit  []model.DailyProfit
}

// SnapshotData 以只读事务读取全部可备份数据，保证导出期间看到一致快照，
// 避免与定投自动入账等并发写入交错产生「持仓已更新但流水未更新」的割裂备份。
func (s *Store) SnapshotData() (*Snapshot, error) {
	// SQLite 通过 DEFERRED 事务提供快照：开启事务后所有读基于同一视图，
	// ReadOnly 提示驱动按只读优化（mattn/go-sqlite3 支持）。
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("开启快照事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	groups, err := queryGroups(tx)
	if err != nil {
		return nil, err
	}
	items, err := queryRawItems(tx)
	if err != nil {
		return nil, err
	}
	positions, err := queryPositions(tx)
	if err != nil {
		return nil, err
	}
	transactions, err := queryAllTxns(tx)
	if err != nil {
		return nil, err
	}
	plans, err := queryAllPlans(tx)
	if err != nil {
		return nil, err
	}
	profits, err := queryAllDailyProfits(tx)
	if err != nil {
		return nil, err
	}
	return &Snapshot{
		Groups:       groups,
		Items:        items,
		Positions:    positions,
		Transactions: transactions,
		DCAPlans:     plans,
		DailyProfit:  profits,
	}, nil
}

func queryGroups(tx *sql.Tx) ([]model.WatchGroup, error) {
	rows, err := tx.Query("SELECT id, name, sort FROM watch_group ORDER BY sort, id")
	if err != nil {
		return nil, fmt.Errorf("查询分组失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	groups := make([]model.WatchGroup, 0, 8)
	for rows.Next() {
		var g model.WatchGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Sort); err != nil {
			return nil, fmt.Errorf("读取分组失败: %w", err)
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func queryRawItems(tx *sql.Tx) ([]model.WatchItem, error) {
	rows, err := tx.Query(`SELECT code, group_id, sort, pinned, created_at
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

func queryPositions(tx *sql.Tx) ([]model.Position, error) {
	rows, err := tx.Query("SELECT code, shares, cost_price, updated_at FROM position")
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

func queryAllTxns(tx *sql.Tx) ([]model.PositionTxn, error) {
	rows, err := tx.Query(`SELECT id, code, date, kind, shares, price, amount, source, COALESCE(note, ''), COALESCE(created_at, 0)
		FROM position_txn ORDER BY code, date, id`)
	if err != nil {
		return nil, fmt.Errorf("查询交易流水失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanTxns(rows)
}

func queryAllPlans(tx *sql.Tx) ([]model.DCAPlan, error) {
	rows, err := tx.Query(`SELECT id, code, freq, day, amount, auto_record, enabled,
		COALESCE(next_run, ''), COALESCE(last_run, ''), COALESCE(created_at, 0), ''
		FROM dca_plan ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("查询定投计划失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanPlans(rows)
}

func queryAllDailyProfits(tx *sql.Tx) ([]model.DailyProfit, error) {
	rows, err := tx.Query("SELECT code, date, nav, growth, profit FROM daily_profit ORDER BY date, code")
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
