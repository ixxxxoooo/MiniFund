// Package logger 提供简单的文件日志能力，日志目录由 config.LogDir() 按平台决定。
package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"minifund/internal/config"
)

var (
	mu   sync.Mutex
	file *os.File
)

// Init 初始化日志系统，打开（或创建）日志文件。
func Init() error {
	dir, err := config.LogDir()
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, "minifund.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("打开日志文件失败: %w", err)
	}
	mu.Lock()
	file = f
	mu.Unlock()
	return nil
}

// Close 关闭日志文件，应用退出前调用。
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if file != nil {
		_ = file.Close()
		file = nil
	}
}

func write(level, format string, args ...any) {
	line := fmt.Sprintf("%s [%s] %s\n", time.Now().Format("2006-01-02 15:04:05.000"), level, fmt.Sprintf(format, args...))
	mu.Lock()
	defer mu.Unlock()
	if file != nil {
		_, _ = file.WriteString(line)
	}
	// 开发期同时输出到标准输出，便于观察
	fmt.Print(line)
}

// Info 记录普通信息日志。
func Info(format string, args ...any) { write("INFO", format, args...) }

// Warn 记录警告日志。
func Warn(format string, args ...any) { write("WARN", format, args...) }

// Error 记录错误日志。
func Error(format string, args ...any) { write("ERROR", format, args...) }
