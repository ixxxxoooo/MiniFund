package services

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"minifund/internal/logger"
	"minifund/internal/model"
	"minifund/internal/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// backupAppName 备份文件中的应用标识，导入时校验，避免误导入其他文件。
const backupAppName = "MiniFund"

// backupVersion 备份格式版本号，向后兼容时递增。
const backupVersion = 1

// backupData 备份文件结构（JSON）。包含自选分组、自选条目、持仓、收益历史与应用设置；
// 不含基金代码表、净值/详情缓存等可重建的派生数据。
type backupData struct {
	App         string             `json:"app"`         // 固定为 MiniFund
	Version     int                `json:"version"`     // 备份格式版本
	ExportedAt  string             `json:"exportedAt"`  // 导出时间（RFC3339）
	Groups      []model.WatchGroup `json:"groups"`      // 自选分组
	Items       []model.WatchItem  `json:"items"`       // 自选条目（保留各自分组）
	Positions   []model.Position   `json:"positions"`   // 持仓
	DailyProfit []model.DailyProfit `json:"dailyProfit"` // 每日收益历史
	Settings    AppSettings        `json:"settings"`    // 应用设置
}

// ImportResult 数据导入结果（暴露给前端展示）。
type ImportResult struct {
	Groups    int `json:"groups"`    // 导入分组数
	Items     int `json:"items"`     // 导入自选条目数
	Positions int `json:"positions"` // 导入持仓数
}

// BackupService 数据备份与恢复服务：通过原生文件对话框导出/导入本地数据。
type BackupService struct {
	store    *storage.Store
	settings *SettingsService
	app      *application.App
	onChange func() // 数据变更后广播（导入后各窗口重载）
}

// NewBackupService 创建备份服务。
func NewBackupService(store *storage.Store, settings *SettingsService) *BackupService {
	return &BackupService{store: store, settings: settings}
}

// SetWailsApplication 注入 Wails 应用实例（装配时调用，用于弹原生对话框）。
func (s *BackupService) SetWailsApplication(app *application.App) {
	s.app = app
}

// SetOnChange 注入数据变更回调（不暴露给前端使用）。
func (s *BackupService) SetOnChange(fn func()) {
	s.onChange = fn
}

// ExportData 导出全部数据到用户选择的 JSON 文件，返回保存路径（用户取消返回空字符串）。
func (s *BackupService) ExportData() (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("应用尚未初始化")
	}
	data, err := s.snapshot()
	if err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化备份失败: %w", err)
	}

	defaultName := fmt.Sprintf("minifund-backup-%s.json", time.Now().Format("20060102-150405"))
	path, err := s.app.Dialog.SaveFile().
		SetFilename(defaultName).
		AddFilter("MiniFund 备份", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("打开保存对话框失败: %w", err)
	}
	if path == "" {
		return "", nil // 用户取消
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return "", fmt.Errorf("写入备份文件失败: %w", err)
	}
	logger.Info("数据已导出至: %s", path)
	return path, nil
}

// ImportData 从用户选择的备份文件恢复数据（整体替换自选/分组/持仓/收益历史并合并设置）。
// 用户取消返回 nil。
func (s *BackupService) ImportData() (*ImportResult, error) {
	if s.app == nil {
		return nil, fmt.Errorf("应用尚未初始化")
	}
	path, err := s.app.Dialog.OpenFile().
		CanChooseFiles(true).
		AddFilter("MiniFund 备份", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return nil, fmt.Errorf("打开文件对话框失败: %w", err)
	}
	if path == "" {
		return nil, nil // 用户取消
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取备份文件失败: %w", err)
	}
	var data backupData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("备份文件格式错误，无法解析: %w", err)
	}
	if data.App != backupAppName {
		return nil, fmt.Errorf("不是有效的 MiniFund 备份文件")
	}
	if data.Version > backupVersion {
		return nil, fmt.Errorf("备份文件版本（v%d）高于当前应用支持的版本（v%d），请升级后重试", data.Version, backupVersion)
	}
	if len(data.Groups) == 0 {
		return nil, fmt.Errorf("备份文件不含任何分组，已取消导入")
	}

	if err := s.store.ReplaceWatchlistData(data.Groups, data.Items, data.Positions, data.DailyProfit); err != nil {
		return nil, err
	}
	// 合并设置（经 SettingsService 走校验、持久化并触发调度器刷新）
	if err := s.settings.Update(data.Settings); err != nil {
		logger.Warn("导入设置失败（自选数据已恢复）: %v", err)
	}
	if s.onChange != nil {
		s.onChange()
	}
	logger.Info("数据导入完成: %d 分组 / %d 自选 / %d 持仓", len(data.Groups), len(data.Items), len(data.Positions))
	return &ImportResult{
		Groups:    len(data.Groups),
		Items:     len(data.Items),
		Positions: len(data.Positions),
	}, nil
}

// snapshot 收集当前全部可备份数据。
func (s *BackupService) snapshot() (*backupData, error) {
	groups, err := s.store.ListGroups()
	if err != nil {
		return nil, err
	}
	items, err := s.store.ListAllRawItems()
	if err != nil {
		return nil, err
	}
	positions, err := s.store.ListPositions()
	if err != nil {
		return nil, err
	}
	profits, err := s.store.ListAllDailyProfits()
	if err != nil {
		return nil, err
	}
	settings, err := s.settings.Get()
	if err != nil {
		return nil, err
	}
	return &backupData{
		App:         backupAppName,
		Version:     backupVersion,
		ExportedAt:  time.Now().Format(time.RFC3339),
		Groups:      groups,
		Items:       items,
		Positions:   positions,
		DailyProfit: profits,
		Settings:    settings,
	}, nil
}
