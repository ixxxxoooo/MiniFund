package app

import (
	"minifund/internal/logger"
	"minifund/services"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// core 应用核心：装配所有服务实例。
type core struct {
	SettingsSvc *services.SettingsService
	FundSvc     *services.FundService
	WindowSvc   *services.WindowService
}

// newCore 创建应用核心并装配服务。
// TODO(M1)：在此装配 storage、datasource、scheduler（见 docs/ROADMAP.md）。
func newCore() *core {
	logger.Info("正在创建应用实例...")

	settingsSvc := services.NewSettingsService()
	c := &core{
		SettingsSvc: settingsSvc,
		FundSvc:     services.NewFundService(),
		WindowSvc:   services.NewWindowService(settingsSvc),
	}
	logger.Info("所有服务实例创建完成")
	return c
}

// services 返回需要注册给 Wails 的服务列表（暴露给前端 bindings）。
func (c *core) services() []application.Service {
	return []application.Service{
		application.NewService(c.SettingsSvc),
		application.NewService(c.FundSvc),
		application.NewService(c.WindowSvc),
	}
}

// shutdown 应用关闭时的资源清理。
func (c *core) shutdown() {
	logger.Info("应用正在关闭...")
	logger.Close()
}
