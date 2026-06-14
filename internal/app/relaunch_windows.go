//go:build windows

package app

import (
	"os"
	"os/exec"
	"syscall"
)

// relaunchApp 在 Windows 上重启应用进程。
// Windows 没有进程组的 Setpgid 概念，改用 CREATE_NEW_PROCESS_GROUP 让子进程脱离
// 父进程的控制台进程组；同时隐藏可能出现的控制台窗口。
func relaunchApp() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
		HideWindow:    true,
	}
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}
