//go:build !darwin

package tray

import (
	_ "embed"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// trayColorIcon 彩色托盘图标（用于 Windows / Linux，这些平台不支持 macOS 模板图标的自动着色）
//
//go:embed assets/tray_icon.png
var trayColorIcon []byte

// applyTrayIcon 在非 macOS 平台上设置彩色图标。
func applyTrayIcon(tray *application.SystemTray) {
	tray.SetIcon(trayColorIcon)
}
