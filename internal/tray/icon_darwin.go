//go:build darwin

package tray

import (
	_ "embed"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// trayTemplateIcon 自定义托盘模板图标（黑色+alpha，由 build/genicon 生成，系统自动适配亮暗）
//
//go:embed assets/tray_template@2x.png
var trayTemplateIcon []byte

// applyTrayIcon 在 macOS 上设置模板图标，由系统按菜单栏亮暗自动着色。
func applyTrayIcon(tray *application.SystemTray) {
	tray.SetTemplateIcon(trayTemplateIcon)
}
