// Package tray 负责系统托盘：图标、标题、右键菜单与托盘面板窗口联动。
// 交互规格见 docs/PRD.md 2.8 节、docs/TECH_DESIGN.md 第 7 节。
package tray

import (
	"minifund/internal/logger"
	"minifund/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Tray 系统托盘封装。
type Tray struct {
	app  *application.App
	tray *application.SystemTray
}

// Options 托盘初始化参数。
type Options struct {
	// PanelWindow 托盘监控面板窗口，左键点击托盘图标时弹出/隐藏
	PanelWindow *application.WebviewWindow
	// OnShowMain 菜单"显示主窗口"回调
	OnShowMain func()
	// OnPauseToggle 菜单"暂停监控"勾选回调
	OnPauseToggle func(paused bool)
	// OnStealthToggle 菜单"摸鱼模式"勾选回调
	OnStealthToggle func(stealth bool)
	// OnRestart 菜单"重启"回调
	OnRestart func()
	// StealthChecked 初始摸鱼模式状态
	StealthChecked bool
}

// Setup 创建并配置系统托盘。
func Setup(app *application.App, opts Options) *Tray {
	t := &Tray{app: app, tray: app.SystemTray.New()}

	// 托盘图标按平台区分：macOS 使用模板图标自动适配菜单栏亮暗，
	// Windows/Linux 使用彩色图标（见 icon_darwin.go / icon_other.go）
	applyTrayIcon(t.tray)

	// 右键菜单
	menu := app.Menu.New()
	menu.Add("显示主窗口").OnClick(func(ctx *application.Context) {
		if opts.OnShowMain != nil {
			opts.OnShowMain()
		}
	})
	menu.AddSeparator()
	pauseItem := menu.AddCheckbox("暂停监控", false)
	pauseItem.OnClick(func(ctx *application.Context) {
		if opts.OnPauseToggle != nil {
			opts.OnPauseToggle(pauseItem.Checked())
		}
	})
	stealthItem := menu.AddCheckbox("摸鱼模式", opts.StealthChecked)
	stealthItem.OnClick(func(ctx *application.Context) {
		if opts.OnStealthToggle != nil {
			opts.OnStealthToggle(stealthItem.Checked())
		}
	})
	menu.AddSeparator()
	menu.Add("重启 " + version.AppName).OnClick(func(ctx *application.Context) {
		if opts.OnRestart != nil {
			opts.OnRestart()
		}
	})
	menu.Add("退出 " + version.AppName).OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	t.tray.SetMenu(menu)

	// 左键点击弹出托盘监控面板（窗口跟随托盘图标定位）
	if opts.PanelWindow != nil {
		t.tray.AttachWindow(opts.PanelWindow).WindowOffset(8)
	}

	logger.Info("系统托盘初始化完成")
	return t
}

// SetTitle 更新托盘标题（菜单栏文字），由监控调度器在估值刷新后调用。
// 必须经 InvokeAsync 回主线程，保证 UI 操作线程安全。
func (t *Tray) SetTitle(title string) {
	application.InvokeAsync(func() {
		t.tray.SetLabel(title)
	})
}
