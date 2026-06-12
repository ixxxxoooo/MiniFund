package app

import (
	"minifund/internal/logger"
	"minifund/internal/tray"
	"minifund/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Run 启动 Wails 应用：装配服务、创建窗口与托盘，进入主循环。
func Run(resources EmbeddedResources) error {
	logger.Info("%s 启动中...", version.AppName)

	coreApp := newCore()

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

	// 注入 Wails 实例后创建窗口
	coreApp.WindowSvc.SetWailsApplication(wailsApp)
	coreApp.WindowSvc.CreateMainWindow()
	panel := coreApp.WindowSvc.CreateTrayPanelWindow()

	// 初始化系统托盘（左键弹面板，右键弹菜单）
	tray.Setup(wailsApp, tray.Options{
		PanelWindow: panel,
		OnShowMain: func() {
			if err := coreApp.WindowSvc.ShowMainWindow(); err != nil {
				logger.Warn("显示主窗口失败: %v", err)
			}
		},
	})

	logger.Info("窗口与托盘初始化完成，进入主循环")
	return wailsApp.Run()
}
