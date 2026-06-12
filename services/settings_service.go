package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"minifund/internal/config"
	"minifund/internal/logger"
)

// AppSettings 应用设置，前后端共享的结构。
type AppSettings struct {
	// Theme 主题：light / dark / system
	Theme string `json:"theme"`
	// CompactMode 紧凑模式
	CompactMode bool `json:"compactMode"`
	// QuoteColorScheme 涨跌配色：cn（红涨绿跌）/ intl（绿涨红跌）
	QuoteColorScheme string `json:"quoteColorScheme"`
	// RefreshIntervalSec 盘中估值刷新间隔（秒），可选 15/30/60
	RefreshIntervalSec int `json:"refreshIntervalSec"`
	// TrayTitleEnabled 托盘标题是否展示涨跌幅
	TrayTitleEnabled bool `json:"trayTitleEnabled"`
	// CloseAction 主窗口关闭行为：hide（隐藏到托盘）/ quit（退出）
	CloseAction string `json:"closeAction"`
}

// defaultSettings 返回默认设置。
func defaultSettings() AppSettings {
	return AppSettings{
		Theme:              "system",
		CompactMode:        false,
		QuoteColorScheme:   "cn",
		RefreshIntervalSec: 30,
		TrayTitleEnabled:   true,
		CloseAction:        "hide",
	}
}

// SettingsService 设置服务：负责设置的读取与持久化（JSON 文件）。
// TODO(M1)：迁移到 SQLite settings 表（见 docs/TECH_DESIGN.md 第 5 节）。
type SettingsService struct {
	mu       sync.RWMutex
	settings AppSettings
	path     string
}

// NewSettingsService 创建设置服务并加载已持久化的设置。
func NewSettingsService() *SettingsService {
	s := &SettingsService{settings: defaultSettings()}
	dir, err := config.AppDataDir()
	if err != nil {
		logger.Warn("获取应用数据目录失败，设置将不持久化: %v", err)
		return s
	}
	s.path = filepath.Join(dir, "settings.json")
	s.load()
	return s
}

// Get 返回当前设置。
func (s *SettingsService) Get() (AppSettings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings, nil
}

// Update 整体更新设置并持久化。
func (s *SettingsService) Update(next AppSettings) error {
	s.mu.Lock()
	s.settings = next
	s.mu.Unlock()
	return s.save()
}

func (s *SettingsService) load() {
	if s.path == "" {
		return
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		// 文件不存在属于首次启动，保持默认设置即可
		if !os.IsNotExist(err) {
			logger.Warn("读取设置文件失败: %v", err)
		}
		return
	}
	var loaded AppSettings
	if err := json.Unmarshal(data, &loaded); err != nil {
		logger.Warn("解析设置文件失败，使用默认设置: %v", err)
		return
	}
	s.mu.Lock()
	s.settings = loaded
	s.mu.Unlock()
}

func (s *SettingsService) save() error {
	if s.path == "" {
		return nil
	}
	s.mu.RLock()
	data, err := json.MarshalIndent(s.settings, "", "  ")
	s.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("序列化设置失败: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o644); err != nil {
		return fmt.Errorf("写入设置文件失败: %w", err)
	}
	return nil
}
