// Package config 提供应用路径与基础常量。
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// appDirName 应用在各平台用户目录下的统一子目录名。
const appDirName = "MiniFund"

// AppDataDir 返回应用数据目录（用于存放 SQLite 数据库等），不存在时自动创建。
//
// 各平台落点：
//   - macOS：~/Library/Application Support/MiniFund
//   - Windows：%AppData%\MiniFund（如 C:\Users\<用户>\AppData\Roaming\MiniFund）
//   - Linux：~/.config/MiniFund
//
// 这里使用 os.UserConfigDir() 抹平平台差异，macOS 下其返回值即为
// ~/Library/Application Support，与历史版本路径保持一致，老用户数据不丢。
func AppDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("获取用户配置目录失败: %w", err)
	}
	dir := filepath.Join(base, appDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	return dir, nil
}

// LogDir 返回应用日志目录，不存在时自动创建。
//
// 各平台落点：
//   - macOS：~/Library/Logs/MiniFund（遵循 macOS 日志惯例）
//   - Windows：%LocalAppData%\MiniFund\logs
//   - 其它：<应用数据目录>/logs
func LogDir() (string, error) {
	var dir string
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("获取用户目录失败: %w", err)
		}
		dir = filepath.Join(home, "Library", "Logs", appDirName)
	case "windows":
		base, err := os.UserCacheDir() // Windows 下为 %LocalAppData%
		if err != nil {
			return "", fmt.Errorf("获取本地缓存目录失败: %w", err)
		}
		dir = filepath.Join(base, appDirName, "logs")
	default:
		data, err := AppDataDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(data, "logs")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建日志目录失败: %w", err)
	}
	return dir, nil
}
