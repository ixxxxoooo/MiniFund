package services

import (
	"fmt"
	"strings"

	"minifund/internal/model"
	"minifund/internal/scheduler"
	"minifund/internal/storage"
)

// WatchlistService 自选与分组管理服务。
type WatchlistService struct {
	store    *storage.Store
	sched    *scheduler.Scheduler
	onChange func() // 自选变更通知（广播给所有窗口，保证主窗口/托盘面板同步）
}

// NewWatchlistService 创建自选服务。
func NewWatchlistService(store *storage.Store) *WatchlistService {
	return &WatchlistService{store: store}
}

// SetScheduler 注入调度器（装配时调用，不暴露给前端使用）。
func (s *WatchlistService) SetScheduler(sched *scheduler.Scheduler) {
	s.sched = sched
}

// SetOnChange 注入自选变更回调（不暴露给前端使用）。
func (s *WatchlistService) SetOnChange(fn func()) {
	s.onChange = fn
}

// refresh 自选变更后立即触发一轮估值拉取并广播变更事件。
func (s *WatchlistService) refresh() {
	if s.sched != nil {
		s.sched.RefreshNow()
	}
	if s.onChange != nil {
		s.onChange()
	}
}

// ListGroups 返回全部分组。
func (s *WatchlistService) ListGroups() ([]model.WatchGroup, error) {
	return s.store.ListGroups()
}

// CreateGroup 新建分组。
func (s *WatchlistService) CreateGroup(name string) (*model.WatchGroup, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("分组名称不能为空")
	}
	g, err := s.store.CreateGroup(name)
	if err == nil && s.onChange != nil {
		s.onChange()
	}
	return g, err
}

// RenameGroup 重命名分组。
func (s *WatchlistService) RenameGroup(id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("分组名称不能为空")
	}
	return s.store.RenameGroup(id, name)
}

// DeleteGroup 删除分组及其条目。
func (s *WatchlistService) DeleteGroup(id int64) error {
	groups, err := s.store.ListGroups()
	if err != nil {
		return err
	}
	if len(groups) <= 1 {
		return fmt.Errorf("至少保留一个分组")
	}
	if err := s.store.DeleteGroup(id); err != nil {
		return err
	}
	s.refresh()
	return nil
}

// ListItems 返回某分组下的自选条目。
func (s *WatchlistService) ListItems(groupID int64) ([]model.WatchItem, error) {
	return s.store.ListItems(groupID)
}

// AddItem 添加自选并立即刷新估值。
func (s *WatchlistService) AddItem(code string, groupID int64) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return fmt.Errorf("基金代码不能为空")
	}
	if err := s.store.AddItem(code, groupID); err != nil {
		return err
	}
	s.refresh()
	return nil
}

// RemoveItem 移除自选。
func (s *WatchlistService) RemoveItem(code string, groupID int64) error {
	if err := s.store.RemoveItem(code, groupID); err != nil {
		return err
	}
	s.refresh()
	return nil
}
