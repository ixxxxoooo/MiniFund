# MiniFund

基金监控桌面工具（macOS），基于 Wails3 + Go + React 构建。支持基金搜索、盘中估值实时监控、持仓盈亏、多窗口与系统托盘监控面板。

> 数据来源为天天基金等公开接口，估值为估算值，仅供参考，不构成投资建议。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | 产品需求：功能模块、监控时间策略、版本路线 |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | 数据源调研：接口规格、限频与降级策略 |
| [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) | 技术设计：架构、多窗口、托盘、存储 schema、事件协议 |
| [docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md) | UI 规范：主题 token、组件规范、涨跌色规范 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 迭代计划与任务拆解 |
| [AGENTS.md](AGENTS.md) | 开发验证流程与硬性规范 |

## 技术栈

- 后端：Go 1.25+ / Wails v3（alpha）
- 前端：React 18 + TypeScript + Vite + Tailwind CSS + zustand
- 包管理：pnpm

## 开发

```bash
# 安装 wails3 CLI（如未安装）
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

# 开发模式（热重载）
wails3 dev -config ./build/config.yml

# 运行测试
go test ./...
cd frontend && pnpm test

# 构建
wails3 build

# 打包 macOS .app
wails3 task package:darwin ARCH=arm64
```

## 目录结构

```
internal/        Go 内部模块（app 装配 / 日志 / 托盘 / 数据源 / 调度器 / 存储）
services/        Wails 服务层（暴露给前端的 API）
frontend/        React 前端（src/windows 为各窗口入口）
build/           构建配置（Taskfile / Info.plist / 图标）
docs/            开发文档
.cursor/rules/   Cursor 项目开发规则
```
