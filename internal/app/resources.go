package app

import "embed"

// EmbeddedResources 由 main 包注入的嵌入式资源。
type EmbeddedResources struct {
	// Assets 前端构建产物（frontend/dist）
	Assets embed.FS
}
