package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"minifund/internal/model"
)

// GetKlineCache 读取指定指数+周期的 K 线缓存（按日期升序）；不存在返回空切片。
// 历史 K 线不可变，缓存可长期保留，仅最新一根需增量刷新（由上层合并最新数据）。
func (s *Store) GetKlineCache(secid, period string) ([]model.Kline, error) {
	var payload string
	err := s.db.QueryRow("SELECT payload FROM kline_cache WHERE secid = ? AND period = ?", secid, period).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取 K 线缓存失败: %w", err)
	}
	var list []model.Kline
	if err := json.Unmarshal([]byte(payload), &list); err != nil {
		return nil, fmt.Errorf("解析 K 线缓存失败: %w", err)
	}
	return list, nil
}

// SaveKlineCache 写入（覆盖）指定指数+周期的 K 线缓存；list 应已按日期升序排列。
func (s *Store) SaveKlineCache(secid, period string, list []model.Kline) error {
	if len(list) == 0 {
		return nil
	}
	payload, err := json.Marshal(list)
	if err != nil {
		return fmt.Errorf("序列化 K 线缓存失败: %w", err)
	}
	maxDate := list[len(list)-1].Date
	_, err = s.db.Exec(`INSERT INTO kline_cache (secid, period, payload, max_date, fetched_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(secid, period) DO UPDATE SET payload = excluded.payload, max_date = excluded.max_date, fetched_at = excluded.fetched_at`,
		secid, period, string(payload), maxDate, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("写入 K 线缓存失败: %w", err)
	}
	return nil
}
