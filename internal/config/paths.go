// Package config 提供应用路径与基础常量。
package config

import (
	"fmt"
	"os"
	"path/filepath"
)

// AppDataDir 返回应用数据目录（~/Library/Application Support/MiniFund），不存在时自动创建。
func AppDataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户目录失败: %w", err)
	}
	dir := filepath.Join(home, "Library", "Application Support", "MiniFund")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	return dir, nil
}
