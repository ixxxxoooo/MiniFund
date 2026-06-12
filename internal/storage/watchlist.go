package storage

import (
	"fmt"
	"time"

	"minifund/internal/model"
)

// ListGroups 返回全部自选分组（无分组时自动创建默认分组）。
func (s *Store) ListGroups() ([]model.WatchGroup, error) {
	groups, err := s.queryGroups()
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		if _, err := s.db.Exec("INSERT INTO watch_group (name, sort) VALUES ('自选', 0)"); err != nil {
			return nil, fmt.Errorf("创建默认分组失败: %w", err)
		}
		return s.queryGroups()
	}
	return groups, nil
}

func (s *Store) queryGroups() ([]model.WatchGroup, error) {
	rows, err := s.db.Query("SELECT id, name, sort FROM watch_group ORDER BY sort, id")
	if err != nil {
		return nil, fmt.Errorf("查询分组失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	groups := make([]model.WatchGroup, 0, 4)
	for rows.Next() {
		var g model.WatchGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Sort); err != nil {
			return nil, fmt.Errorf("读取分组失败: %w", err)
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// CreateGroup 新建分组。
func (s *Store) CreateGroup(name string) (*model.WatchGroup, error) {
	res, err := s.db.Exec("INSERT INTO watch_group (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM watch_group))", name)
	if err != nil {
		return nil, fmt.Errorf("创建分组失败: %w", err)
	}
	id, _ := res.LastInsertId()
	return &model.WatchGroup{ID: id, Name: name}, nil
}

// RenameGroup 重命名分组。
func (s *Store) RenameGroup(id int64, name string) error {
	_, err := s.db.Exec("UPDATE watch_group SET name = ? WHERE id = ?", name, id)
	if err != nil {
		return fmt.Errorf("重命名分组失败: %w", err)
	}
	return nil
}

// DeleteGroup 删除分组及其条目。
func (s *Store) DeleteGroup(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec("DELETE FROM watch_item WHERE group_id = ?", id); err != nil {
		return fmt.Errorf("删除分组条目失败: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM watch_group WHERE id = ?", id); err != nil {
		return fmt.Errorf("删除分组失败: %w", err)
	}
	return tx.Commit()
}

// ListItems 返回某分组下的自选条目（联查基金名称与类型）。
func (s *Store) ListItems(groupID int64) ([]model.WatchItem, error) {
	rows, err := s.db.Query(`
		SELECT w.code, w.group_id, w.sort, w.pinned, w.created_at,
		       COALESCE(f.name, ''), COALESCE(f.type, '')
		FROM watch_item w LEFT JOIN fund_index f ON f.code = w.code
		WHERE w.group_id = ?
		ORDER BY w.pinned DESC, w.sort, w.created_at`, groupID)
	if err != nil {
		return nil, fmt.Errorf("查询自选条目失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.WatchItem, 0, 16)
	for rows.Next() {
		var it model.WatchItem
		var pinned int
		if err := rows.Scan(&it.Code, &it.GroupID, &it.Sort, &pinned, &it.CreatedAt, &it.Name, &it.Type); err != nil {
			return nil, fmt.Errorf("读取自选条目失败: %w", err)
		}
		it.Pinned = pinned != 0
		items = append(items, it)
	}
	return items, rows.Err()
}

// AllWatchedCodes 返回所有分组去重后的自选基金代码（调度器轮询用）。
func (s *Store) AllWatchedCodes() ([]string, error) {
	rows, err := s.db.Query("SELECT DISTINCT code FROM watch_item")
	if err != nil {
		return nil, fmt.Errorf("查询自选代码失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	codes := make([]string, 0, 32)
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, rows.Err()
}

// AddItem 添加自选。
func (s *Store) AddItem(code string, groupID int64) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO watch_item (code, group_id, sort, created_at)
		VALUES (?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM watch_item WHERE group_id = ?), ?)`,
		code, groupID, groupID, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("添加自选失败: %w", err)
	}
	return nil
}

// RemoveItem 移除自选。
func (s *Store) RemoveItem(code string, groupID int64) error {
	_, err := s.db.Exec("DELETE FROM watch_item WHERE code = ? AND group_id = ?", code, groupID)
	if err != nil {
		return fmt.Errorf("移除自选失败: %w", err)
	}
	return nil
}
