package storage

import (
	"fmt"

	"minifund/internal/logger"
)

// migrations 版本化迁移列表：索引 i 对应版本 i+1，只允许追加，禁止修改历史项。
var migrations = []string{
	// v1：初始表结构（docs/TECH_DESIGN.md 第 5 节）
	`
	CREATE TABLE IF NOT EXISTS fund_index (
		code TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT,
		pinyin_abbr TEXT,
		pinyin_full TEXT,
		updated_at INTEGER
	);
	CREATE TABLE IF NOT EXISTS watch_group (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		sort INTEGER DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS watch_item (
		code TEXT NOT NULL,
		group_id INTEGER NOT NULL REFERENCES watch_group(id) ON DELETE CASCADE,
		sort INTEGER DEFAULT 0,
		pinned INTEGER DEFAULT 0,
		created_at INTEGER,
		PRIMARY KEY (code, group_id)
	);
	CREATE TABLE IF NOT EXISTS position (
		code TEXT PRIMARY KEY,
		shares REAL NOT NULL,
		cost_price REAL NOT NULL,
		updated_at INTEGER
	);
	CREATE TABLE IF NOT EXISTS daily_profit (
		code TEXT,
		date TEXT,
		nav REAL,
		growth REAL,
		profit REAL,
		PRIMARY KEY (code, date)
	);
	CREATE TABLE IF NOT EXISTS nav_history (
		code TEXT,
		date TEXT,
		nav REAL,
		acc_nav REAL,
		growth REAL,
		PRIMARY KEY (code, date)
	);
	CREATE TABLE IF NOT EXISTS detail_cache (
		code TEXT PRIMARY KEY,
		payload TEXT,
		fetched_at INTEGER
	);
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT
	);
	`,
	// v2：基金所属主题/概念缓存（来自东财搜索接口 ZTJJInfo，变动缓慢，长 TTL 缓存避免重复请求）
	`
	CREATE TABLE IF NOT EXISTS fund_theme (
		code TEXT PRIMARY KEY,
		themes TEXT,
		updated_at INTEGER
	);
	`,
	// v3：持仓交易流水（份额变动唯一真相源，position 表退化为派生缓存）与定投计划。
	// 同时把现有 position 单条记录回填为一笔买入流水，保证流水非空且派生一致。
	`
	CREATE TABLE IF NOT EXISTS position_txn (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL,
		date TEXT NOT NULL,
		kind TEXT NOT NULL,
		shares REAL NOT NULL,
		price REAL NOT NULL,
		amount REAL NOT NULL,
		source TEXT NOT NULL,
		note TEXT,
		created_at INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_position_txn_code ON position_txn(code);
	CREATE TABLE IF NOT EXISTS dca_plan (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL,
		freq TEXT NOT NULL,
		day INTEGER NOT NULL,
		amount REAL NOT NULL,
		auto_record INTEGER DEFAULT 0,
		enabled INTEGER DEFAULT 1,
		next_run TEXT,
		last_run TEXT,
		created_at INTEGER
	);
	INSERT INTO position_txn (code, date, kind, shares, price, amount, source, note, created_at)
		SELECT code, date(COALESCE(updated_at, strftime('%s','now')), 'unixepoch', 'localtime'),
			'buy', shares, cost_price, shares * cost_price, 'manual', '迁移自原持仓', COALESCE(updated_at, strftime('%s','now'))
		FROM position;
	`,
}

// migrate 按 PRAGMA user_version 顺序执行未应用的迁移。
func (s *Store) migrate() error {
	var current int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("读取数据库版本失败: %w", err)
	}
	for i := current; i < len(migrations); i++ {
		version := i + 1
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("开启迁移事务失败: %w", err)
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("执行迁移 v%d 失败: %w", version, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", version)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("更新数据库版本失败: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("提交迁移 v%d 失败: %w", version, err)
		}
		logger.Info("数据库迁移完成: v%d", version)
	}
	return nil
}
