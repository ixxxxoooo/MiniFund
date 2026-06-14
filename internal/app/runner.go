package app

import (
	"minifund/internal/logger"
	"minifund/internal/tray"
	"minifund/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// relaunchApp 启动一个新的应用进程（用于「重启」），其平台相关实现见
// relaunch_unix.go 与 relaunch_windows.go。调用方随后应退出当前进程。

// Run 启动 Wails 应用：装配服务、创建窗口与托盘，进入主循环。
func Run(resources EmbeddedResources) error {
	logger.Info("%s 启动中...", version.AppName)

	coreApp, err := newCore()
	if err != nil {
		return err
	}

	wailsApp := application.New(application.Options{
		Name:        version.AppName,
		Description: version.Description,
		Services:    coreApp.services(),
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(resources.Assets),
		},
		Mac: application.MacOptions{
			// 关闭最后一个窗口不退出应用：常驻托盘后台监控
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		OnShutdown: func() {
			coreApp.shutdown()
		},
	})

	// 注入 Wails 实例：装配调度器并启动后台任务
	coreApp.startup(wailsApp)

	// 备份服务需要 Wails 实例弹原生文件对话框
	coreApp.BackupSvc.SetWailsApplication(wailsApp)

	// 创建窗口
	coreApp.WindowSvc.SetWailsApplication(wailsApp)
	coreApp.WindowSvc.CreateMainWindow()
	panel := coreApp.WindowSvc.CreateTrayPanelWindow()

	// 初始化系统托盘（左键弹面板，右键弹菜单）
	settings, _ := coreApp.SettingsSvc.Get()
	sysTray := tray.Setup(wailsApp, tray.Options{
		PanelWindow:    panel,
		StealthChecked: settings.StealthMode,
		OnShowMain: func() {
			if err := coreApp.WindowSvc.ShowMainWindow(); err != nil {
				logger.Warn("显示主窗口失败: %v", err)
			}
		},
		OnPauseToggle: func(paused bool) {
			coreApp.Scheduler.Pause(paused)
		},
		OnStealthToggle: func(stealth bool) {
			current, _ := coreApp.SettingsSvc.Get()
			current.StealthMode = stealth
			if err := coreApp.SettingsSvc.Update(current); err != nil {
				logger.Warn("切换摸鱼模式失败: %v", err)
			}
		},
		OnRestart: func() {
			logger.Info("收到重启请求，启动新实例并退出当前进程")
			if err := relaunchApp(); err != nil {
				logger.Warn("重启失败: %v", err)
				return
			}
			wailsApp.Quit()
		},
	})

	// 调度器刷新后联动托盘标题
	coreApp.Scheduler.SetTrayTitleUpdater(sysTray.SetTitle)

	logger.Info("窗口与托盘初始化完成，进入主循环")
	return wailsApp.Run()
}
