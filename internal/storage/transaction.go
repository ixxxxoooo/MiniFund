package storage

import (
	"database/sql"
	"fmt"
	"time"

	"minifund/internal/model"
)

// ListTransactions 返回某基金的全部交易流水（按日期、id 升序）。
func (s *Store) ListTransactions(code string) ([]model.PositionTxn, error) {
	rows, err := s.db.Query(`SELECT id, code, date, kind, shares, price, amount, source, COALESCE(note, ''), COALESCE(created_at, 0)
		FROM position_txn WHERE code = ? ORDER BY date, id`, code)
	if err != nil {
		return nil, fmt.Errorf("查询交易流水失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanTxns(rows)
}

// ListAllTransactions 返回全部交易流水（数据备份导出用）。
func (s *Store) ListAllTransactions() ([]model.PositionTxn, error) {
	rows, err := s.db.Query(`SELECT id, code, date, kind, shares, price, amount, source, COALESCE(note, ''), COALESCE(created_at, 0)
		FROM position_txn ORDER BY code, date, id`)
	if err != nil {
		return nil, fmt.Errorf("查询交易流水失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanTxns(rows)
}

// scanTxns 读取交易流水结果集。
func scanTxns(rows *sql.Rows) ([]model.PositionTxn, error) {
	items := make([]model.PositionTxn, 0, 16)
	for rows.Next() {
		var t model.PositionTxn
		if err := rows.Scan(&t.ID, &t.Code, &t.Date, &t.Kind, &t.Shares, &t.Price, &t.Amount, &t.Source, &t.Note, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("读取交易流水失败: %w", err)
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// AddTransaction 新增一笔交易流水，并在同一事务内重算该基金持仓派生缓存。
func (s *Store) AddTransaction(t model.PositionTxn) error {
	if t.CreatedAt == 0 {
		t.CreatedAt = time.Now().Unix()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启交易事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`INSERT INTO position_txn (code, date, kind, shares, price, amount, source, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.Code, t.Date, t.Kind, t.Shares, t.Price, t.Amount, t.Source, t.Note, t.CreatedAt); err != nil {
		return fmt.Errorf("写入交易流水失败: %w", err)
	}
	if err := recomputePositionTx(tx, t.Code); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteTransaction 删除一笔交易流水，并重算对应基金的持仓派生缓存。
func (s *Store) DeleteTransaction(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启交易事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var code string
	err = tx.QueryRow("SELECT code FROM position_txn WHERE id = ?", id).Scan(&code)
	if err != nil {
		return fmt.Errorf("查询待删除流水失败: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM position_txn WHERE id = ?", id); err != nil {
		return fmt.Errorf("删除交易流水失败: %w", err)
	}
	if err := recomputePositionTx(tx, code); err != nil {
		return err
	}
	return tx.Commit()
}

// SetBaselinePosition 设为基准持仓：清空该基金现有流水，写入一笔基准买入，再重算。
// 供「直接编辑份额/成本」的手动覆盖入口使用，避免新旧模型冲突。
func (s *Store) SetBaselinePosition(code string, shares, costPrice float64) error {
	now := time.Now()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启交易事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec("DELETE FROM position_txn WHERE code = ?", code); err != nil {
		return fmt.Errorf("清空原流水失败: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO position_txn (code, date, kind, shares, price, amount, source, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		code, now.Format("2006-01-02"), model.TxnKindBuy, shares, costPrice, shares*costPrice,
		model.TxnSourceManual, "基准持仓", now.Unix()); err != nil {
		return fmt.Errorf("写入基准持仓失败: %w", err)
	}
	if err := recomputePositionTx(tx, code); err != nil {
		return err
	}
	return tx.Commit()
}

// ListClearedCodes 返回「已清仓」的基金代码：曾有交易流水但当前无持仓缓存
// （清仓时 recomputePosition 会删除 position 行，故此处即净份额为 0 的历史持仓）。
func (s *Store) ListClearedCodes() ([]string, error) {
	rows, err := s.db.Query(`SELECT DISTINCT t.code FROM position_txn t
		LEFT JOIN position p ON p.code = t.code
		WHERE p.code IS NULL ORDER BY t.code`)
	if err != nil {
		return nil, fmt.Errorf("查询已清仓基金失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	codes := make([]string, 0, 8)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, fmt.Errorf("读取已清仓基金失败: %w", err)
		}
		codes = append(codes, code)
	}
	return codes, rows.Err()
}

// ClearTransactions 清空某基金的全部交易流水（删除持仓时调用）。
func (s *Store) ClearTransactions(code string) error {
	if _, err := s.db.Exec("DELETE FROM position_txn WHERE code = ?", code); err != nil {
		return fmt.Errorf("清空交易流水失败: %w", err)
	}
	return nil
}

// RecomputeAllPositions 重算全部基金的持仓派生缓存（数据导入后调用）。
func (s *Store) RecomputeAllPositions() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启重算事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec("DELETE FROM position"); err != nil {
		return fmt.Errorf("清空持仓缓存失败: %w", err)
	}
	rows, err := tx.Query("SELECT DISTINCT code FROM position_txn")
	if err != nil {
		return fmt.Errorf("查询流水基金集合失败: %w", err)
	}
	codes := make([]string, 0, 16)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			_ = rows.Close()
			return fmt.Errorf("读取流水基金代码失败: %w", err)
		}
		codes = append(codes, code)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()

	for _, code := range codes {
		if err := recomputePositionTx(tx, code); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// recomputePositionTx 在事务内由交易流水重算某基金持仓：
//
//	份额 = Σ买入份额 − Σ卖出份额
//	成本价 = 移动加权平均（买入摊薄均价，卖出不改均价）
//
// 净份额 ≤ 0 时删除该基金的持仓缓存。
func recomputePositionTx(tx *sql.Tx, code string) error {
	rows, err := tx.Query("SELECT kind, shares, price FROM position_txn WHERE code = ? ORDER BY date, id", code)
	if err != nil {
		return fmt.Errorf("查询持仓流水失败: %w", err)
	}
	var shares, cost float64
	for rows.Next() {
		var kind string
		var sh, pr float64
		if err := rows.Scan(&kind, &sh, &pr); err != nil {
			_ = rows.Close()
			return fmt.Errorf("读取持仓流水失败: %w", err)
		}
		switch kind {
		case model.TxnKindBuy:
			newShares := shares + sh
			if newShares > 0 {
				cost = (shares*cost + sh*pr) / newShares
			}
			shares = newShares
		case model.TxnKindSell:
			shares -= sh
			if shares <= 0 {
				shares = 0
				cost = 0
			}
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()

	if shares <= 0 {
		if _, err := tx.Exec("DELETE FROM position WHERE code = ?", code); err != nil {
			return fmt.Errorf("删除空持仓缓存失败: %w", err)
		}
		return nil
	}
	if _, err := tx.Exec(`INSERT INTO position (code, shares, cost_price, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET shares = excluded.shares, cost_price = excluded.cost_price, updated_at = excluded.updated_at`,
		code, shares, cost, time.Now().Unix()); err != nil {
		return fmt.Errorf("回写持仓缓存失败: %w", err)
	}
	return nil
}
