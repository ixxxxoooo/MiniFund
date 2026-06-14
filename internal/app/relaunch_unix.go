//go:build !windows

package app

import (
	"os"
	"os/exec"
	"syscall"
)

// relaunchApp 在类 Unix 系统上重启应用进程。
// 子进程放入独立进程组并脱离父进程标准流，避免父进程退出时被连带终止。
func relaunchApp() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	// 独立进程组：父进程退出不会向子进程发送信号
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// 不继承父进程标准流，避免父进程退出后文件描述符关闭导致子进程异常
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}
