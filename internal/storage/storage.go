// Package storage 提供 SQLite 本地存储：基金代码表、自选、持仓、缓存与设置。
// 表结构见 docs/TECH_DESIGN.md 第 5 节，结构变更必须通过 migrations.go 追加版本化迁移。
package storage

import (
	"database/sql"
	"fmt"
	"path/filepath"

	"minifund/internal/config"
	"minifund/internal/logger"

	_ "github.com/mattn/go-sqlite3"
)

// Store SQLite 存储封装。
type Store struct {
	db *sql.DB
}

// NewStore 打开（或创建）数据库并执行迁移。
func NewStore() (*Store, error) {
	dir, err := config.AppDataDir()
	if err != nil {
		return nil, err
	}
	return newStoreAt(filepath.Join(dir, "minifund.db"))
}

// newStoreAt 在指定路径打开数据库（便于单元测试使用临时文件）。
func newStoreAt(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}
	// SQLite 单写者模型，限制连接数避免锁竞争
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	logger.Info("SQLite 存储初始化成功: %s", path)
	return s, nil
}

// Close 关闭数据库。
func (s *Store) Close() {
	if s.db != nil {
		_ = s.db.Close()
	}
}
