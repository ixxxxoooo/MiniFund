package services

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"minifund/internal/logger"
	"minifund/internal/storage"
)

// settingsKey SQLite settings 表中的 KV 键。
const settingsKey = "app"

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
	// TrayTitleTarget 托盘标题展示目标（指数 symbol 或基金代码，空为关闭）
	TrayTitleTarget string `json:"trayTitleTarget"`
	// StealthMode 摸鱼模式：涨跌中性展示、金额隐藏
	StealthMode bool `json:"stealthMode"`
	// CloseAction 主窗口关闭行为：hide（隐藏到托盘）/ quit（退出）
	CloseAction string `json:"closeAction"`
	// WatchedIndexes 订阅的指数列表
	WatchedIndexes []string `json:"watchedIndexes"`
	// NewsNotify 收到新的财经快讯时是否弹桌面通知
	NewsNotify bool `json:"newsNotify"`
	// NewsPollSec 快讯定时拉取间隔（秒），最小 30
	NewsPollSec int `json:"newsPollSec"`
	// AIEnabled 是否启用 AI 解读
	AIEnabled bool `json:"aiEnabled"`
	// AIBaseURL AI 服务地址（OpenAI 兼容，如 https://api.deepseek.com/v1）
	AIBaseURL string `json:"aiBaseURL"`
	// AIKey AI 服务密钥
	AIKey string `json:"aiKey"`
	// AIModel 模型名（如 deepseek-chat）
	AIModel string `json:"aiModel"`
}

// defaultSettings 返回默认设置。
func defaultSettings() AppSettings {
	return AppSettings{
		Theme:              "system",
		CompactMode:        false,
		QuoteColorScheme:   "cn",
		RefreshIntervalSec: 30,
		TrayTitleTarget:    "sh000001",
		StealthMode:        false,
		CloseAction:        "hide",
		WatchedIndexes:     []string{"sh000001", "sz399001", "sz399006", "sh000300", "hkHSI", "usIXIC"},
		NewsNotify:         false,
		NewsPollSec:        60,
		AIEnabled:          false,
		AIBaseURL:          "https://api.deepseek.com/v1",
		AIModel:            "deepseek-chat",
	}
}

// SettingsService 设置服务：持久化到 SQLite settings 表。
// 同时实现 scheduler.SettingsProvider 接口供调度器读取。
type SettingsService struct {
	store *storage.Store

	mu       sync.RWMutex
	settings AppSettings
	onChange func() // 设置变更回调（装配时注入，触发调度器立即刷新）
}

// NewSettingsService 创建设置服务并加载持久化设置。
func NewSettingsService(store *storage.Store) *SettingsService {
	s := &SettingsService{store: store, settings: defaultSettings()}
	s.load()
	return s
}

// SetOnChange 注入设置变更回调（不暴露给前端使用）。
func (s *SettingsService) SetOnChange(fn func()) {
	s.mu.Lock()
	s.onChange = fn
	s.mu.Unlock()
}

// Get 返回当前设置。
func (s *SettingsService) Get() (AppSettings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings, nil
}

// Update 整体更新设置并持久化。
func (s *SettingsService) Update(next AppSettings) error {
	// 基础校验，避免异常值破坏调度
	if next.RefreshIntervalSec < 15 {
		next.RefreshIntervalSec = 15
	}
	if next.CloseAction != "quit" {
		next.CloseAction = "hide"
	}
	if next.QuoteColorScheme != "intl" {
		next.QuoteColorScheme = "cn"
	}
	if next.NewsPollSec < 30 {
		next.NewsPollSec = 30
	}
	data, err := json.Marshal(next)
	if err != nil {
		return fmt.Errorf("序列化设置失败: %w", err)
	}
	if err := s.store.SetSetting(settingsKey, string(data)); err != nil {
		return err
	}
	s.mu.Lock()
	s.settings = next
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		fn()
	}
	return nil
}

func (s *SettingsService) load() {
	raw, err := s.store.GetSetting(settingsKey)
	if err != nil {
		logger.Warn("读取设置失败，使用默认设置: %v", err)
		return
	}
	if raw == "" {
		return // 首次启动
	}
	var loaded AppSettings
	if err := json.Unmarshal([]byte(raw), &loaded); err != nil {
		logger.Warn("解析设置失败，使用默认设置: %v", err)
		return
	}
	if len(loaded.WatchedIndexes) == 0 {
		loaded.WatchedIndexes = defaultSettings().WatchedIndexes
	}
	if loaded.NewsPollSec < 30 {
		loaded.NewsPollSec = defaultSettings().NewsPollSec
	}
	s.mu.Lock()
	s.settings = loaded
	s.mu.Unlock()
}

// ===== scheduler.SettingsProvider 实现 =====

// EstimateInterval 盘中估值轮询间隔。
func (s *SettingsService) EstimateInterval() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return time.Duration(s.settings.RefreshIntervalSec) * time.Second
}

// WatchedIndexes 订阅的指数代码。
func (s *SettingsService) WatchedIndexes() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, len(s.settings.WatchedIndexes))
	copy(out, s.settings.WatchedIndexes)
	return out
}

// TrayTitleTarget 托盘标题展示目标。
func (s *SettingsService) TrayTitleTarget() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.TrayTitleTarget
}

// StealthMode 摸鱼模式开关。
func (s *SettingsService) StealthMode() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.StealthMode
}

// NewsPollInterval 财经快讯定时拉取间隔。
func (s *SettingsService) NewsPollInterval() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sec := s.settings.NewsPollSec
	if sec < 30 {
		sec = 30
	}
	return time.Duration(sec) * time.Second
}

// NewsNotifyEnabled 是否在收到新快讯时弹桌面通知。
func (s *SettingsService) NewsNotifyEnabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.NewsNotify
}

// AIConfig 返回 AI 解读配置（启用状态 + 服务地址/密钥/模型）。
func (s *SettingsService) AIConfig() (enabled bool, baseURL, apiKey, mdl string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.AIEnabled, s.settings.AIBaseURL, s.settings.AIKey, s.settings.AIModel
}
