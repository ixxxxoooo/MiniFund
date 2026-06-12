// Package version 集中管理应用名称与版本信息，构建时通过 ldflags 注入。
package version

var (
	// AppName 应用名称
	AppName = "MiniFund"
	// Description 应用描述
	Description = "基金监控桌面工具"
	// Version 语义化版本号，构建时注入
	Version = "0.0.1"
	// Commit 构建时的 git 提交哈希
	Commit = "dev"
	// BuildDate 构建时间（UTC）
	BuildDate = ""
)
