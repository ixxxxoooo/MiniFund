package services

import (
	"fmt"
	"sync"

	"minifund/internal/logger"
	"minifund/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// WindowService 多窗口管理服务：负责主窗口、托盘面板窗口、基金详情独立窗口的创建与复用。
// 窗口规格见 docs/TECH_DESIGN.md 第 6 节。
type WindowService struct {
	app      *application.App
	settings *SettingsService

	// onTrayPanelVisible 托盘面板显隐回调（用于调度器提速，装配时注入）
	onTrayPanelVisible func(visible bool)

	mu        sync.Mutex
	main      *application.WebviewWindow
	trayPanel *application.WebviewWindow
	details   map[string]*application.WebviewWindow
	news      map[string]*application.WebviewWindow
}

// NewWindowService 创建窗口管理服务。
func NewWindowService(settings *SettingsService) *WindowService {
	return &WindowService{
		settings: settings,
		details:  make(map[string]*application.WebviewWindow),
		news:     make(map[string]*application.WebviewWindow),
	}
}

// SetWailsApplication 注入 Wails 应用实例（在 runner 中调用，不暴露给前端使用）。
func (s *WindowService) SetWailsApplication(app *application.App) {
	s.app = app
}

// SetTrayPanelVisibilityListener 注入托盘面板显隐回调（不暴露给前端使用）。
func (s *WindowService) SetTrayPanelVisibilityListener(fn func(visible bool)) {
	s.onTrayPanelVisible = fn
}

// CreateMainWindow 创建主窗口（应用启动时由 runner 调用一次）。
func (s *WindowService) CreateMainWindow() *application.WebviewWindow {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.main != nil {
		return s.main
	}
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     version.AppName,
		Width:     1560,
		Height:    1000,
		MinWidth:  1160,
		MinHeight: 720,
		URL:       "/#/main",
		// 隐藏原生标题栏，使用前端自绘窗口控制按钮
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameAqua,
		},
	})
	// 主窗口关闭行为：默认拦截为隐藏到托盘，后台继续监控（设置可改为直接退出）
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		settings, _ := s.settings.Get()
		if settings.CloseAction == "quit" {
			return
		}
		e.Cancel()
		win.Hide()
	})
	s.main = win
	return win
}

// CreateTrayPanelWindow 创建托盘监控面板窗口（启动时创建但保持隐藏，点击托盘图标弹出）。
func (s *WindowService) CreateTrayPanelWindow() *application.WebviewWindow {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.trayPanel != nil {
		return s.trayPanel
	}
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "tray-panel",
		Title:            "",
		Width:            360,
		Height:           600,
		URL:              "/#/tray",
		Frameless:        true,
		AlwaysOnTop:      true,
		DisableResize:    true,
		Hidden:           true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameAqua,
		},
	})
	// 失焦自动隐藏，符合菜单栏弹出面板的交互习惯
	win.OnWindowEvent(events.Common.WindowLostFocus, func(e *application.WindowEvent) {
		win.Hide()
	})
	// 面板显隐联动调度器提速（打开面板时估值轮询提速至 15s）
	win.OnWindowEvent(events.Common.WindowShow, func(e *application.WindowEvent) {
		if s.onTrayPanelVisible != nil {
			s.onTrayPanelVisible(true)
		}
	})
	win.OnWindowEvent(events.Common.WindowHide, func(e *application.WindowEvent) {
		if s.onTrayPanelVisible != nil {
			s.onTrayPanelVisible(false)
		}
	})
	s.trayPanel = win
	return win
}

// ShowMainWindow 显示并聚焦主窗口（托盘菜单/面板调用）。
func (s *WindowService) ShowMainWindow() error {
	s.mu.Lock()
	win := s.main
	s.mu.Unlock()
	if win == nil {
		return fmt.Errorf("主窗口尚未创建")
	}
	win.Show()
	win.Focus()
	return nil
}

// HideMainWindow 隐藏主窗口（前端自绘关闭按钮调用）。
func (s *WindowService) HideMainWindow() error {
	s.mu.Lock()
	win := s.main
	s.mu.Unlock()
	if win == nil {
		return fmt.Errorf("主窗口尚未创建")
	}
	win.Hide()
	return nil
}

// OpenDetailWindow 打开基金详情独立窗口；同一基金代码复用已存在的窗口。
func (s *WindowService) OpenDetailWindow(code string) error {
	if code == "" {
		return fmt.Errorf("基金代码不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if win, ok := s.details[code]; ok {
		win.Show()
		win.Focus()
		return nil
	}
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "detail-" + code,
		Title:            version.AppName,
		Width:            1120,
		Height:           840,
		MinWidth:         900,
		MinHeight:        640,
		URL:              "/#/detail/" + code,
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameAqua,
		},
	})
	// 窗口关闭后从复用表中移除
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		s.mu.Lock()
		delete(s.details, code)
		s.mu.Unlock()
	})
	s.details[code] = win
	logger.Info("打开基金详情窗口: %s", code)
	return nil
}

// OpenNewsWindow 打开新闻详情独立窗口；同一新闻 id 复用已存在的窗口。
// payload 为前端 base64(JSON) 序列化的新闻数据，通过 hash 路由 /#/news/{payload} 传入窗口。
func (s *WindowService) OpenNewsWindow(id string, payload string) error {
	if id == "" || payload == "" {
		return fmt.Errorf("新闻参数不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if win, ok := s.news[id]; ok {
		win.Show()
		win.Focus()
		return nil
	}
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "news-" + id,
		Title:            version.AppName,
		Width:            1280,
		Height:           900,
		MinWidth:         900,
		MinHeight:        600,
		URL:              "/#/news/" + payload,
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameAqua,
		},
	})
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		s.mu.Lock()
		delete(s.news, id)
		s.mu.Unlock()
	})
	s.news[id] = win
	logger.Info("打开新闻详情窗口: %s", id)
	return nil
}

// QuitApp 退出应用（托盘菜单/设置页调用）。
func (s *WindowService) QuitApp() {
	if s.app != nil {
		s.app.Quit()
	}
}
