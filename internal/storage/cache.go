package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// GetDetailCache 读取基金详情缓存；不存在或超过 maxAge 时返回空字符串。
func (s *Store) GetDetailCache(code string, maxAge time.Duration) (string, error) {
	var payload string
	var fetchedAt int64
	err := s.db.QueryRow("SELECT payload, fetched_at FROM detail_cache WHERE code = ?", code).Scan(&payload, &fetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取详情缓存失败: %w", err)
	}
	if time.Since(time.Unix(fetchedAt, 0)) > maxAge {
		return "", nil
	}
	return payload, nil
}

// SaveDetailCache 写入基金详情缓存。
func (s *Store) SaveDetailCache(code, payload string) error {
	_, err := s.db.Exec(`INSERT INTO detail_cache (code, payload, fetched_at) VALUES (?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
		code, payload, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("写入详情缓存失败: %w", err)
	}
	return nil
}

// GetSetting 读取设置项（KV），不存在返回空字符串。
func (s *Store) GetSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取设置失败: %w", err)
	}
	return value, nil
}

// SetSetting 写入设置项（KV）。
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	if err != nil {
		return fmt.Errorf("写入设置失败: %w", err)
	}
	return nil
}
