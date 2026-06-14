<div align="center">

# MiniFund · 迷你基

**轻量的桌面端基金监控工具** —— 盘中估值实时监控、持仓盈亏、行情中心、资讯快讯与 AI 解读，常驻系统托盘。

[![CI](https://github.com/ixxxxoooo/MiniFund/actions/workflows/ci.yml/badge.svg)](https://github.com/ixxxxoooo/MiniFund/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ixxxxoooo/MiniFund?display_name=tag)](https://github.com/ixxxxoooo/MiniFund/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Go](https://img.shields.io/badge/Go-1.25%2B-00ADD8?logo=go)

</div>

> ⚠️ **免责声明**：本工具数据来源于天天基金、腾讯、新浪等公开接口，**盘中估值为估算值，仅供参考，不构成任何投资建议**。请以基金公司公布的官方净值为准。

---

## ✨ 功能特性

- **基金搜索**：全量基金代码本地索引，`Cmd/Ctrl + K` 全局快速搜索。
- **盘中估值监控**：交易时段按交易日历自动轮询估值，涨跌实时刷新（含债券持仓兜底）。
- **自选与分组**：自选基金分组管理，表格列头排序。
- **持仓盈亏**：持仓成本/份额录入，日盈亏与累计盈亏计算、汇总卡片、金额一键隐藏。
- **基金详情**：净值走势图、历史净值分页、持仓明细、基金经理档案、基金标签。
- **行情中心**：主要指数 K 线 + AI 解读（Markdown 流式输出）。
- **板块与排行**：板块行情、基金排行（按类型/周期筛选）、涨跌分布。
- **资讯快讯**：7×24 全球财经快讯与基金资讯，新增快讯桌面通知（点击直达详情窗口）。
- **多窗口**：主窗口 + 基金详情独立窗口 + 新闻独立窗口 + 托盘监控面板。
- **系统托盘**：托盘标题实时显示涨跌、左键弹出监控面板、右键菜单（暂停监控 / 摸鱼模式 / 重启 / 退出）。
- **摸鱼模式**：一键隐藏敏感信息，托盘与主窗口联动。
- **主题系统**：亮 / 暗 / 跟随系统 / 紧凑模式，可切换涨跌配色（红涨绿跌 ↔ 绿涨红跌）。

## 🖥️ 平台支持

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| macOS (Apple Silicon) | `.dmg` | 含「解除安全限制」脚本，绕过未公证拦截 |
| Windows 10/11 (x64) | `.exe`（zip 内） | 绿色免安装，依赖系统内置 WebView2 |

## 📦 下载与安装

前往 [Releases](https://github.com/ixxxxoooo/MiniFund/releases) 下载对应平台的安装包。

由于本项目为免费开源、未购买商业签名/公证证书，首次打开需要简单的"放行"步骤：

- **macOS**：打开 DMG 后双击其中的 **「解除安全限制.command」**，或在终端执行
  `xattr -dr com.apple.quarantine /Applications/MiniFund.app`。
- **Windows**：若 SmartScreen 拦截，点击「更多信息」→「仍要运行」。

详细图文步骤见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 🧱 技术栈

- **后端**：Go 1.25+ / [Wails v3](https://v3.wails.io/)（alpha）/ SQLite（go-sqlite3, CGO）
- **前端**：React 18 + TypeScript + Vite + Tailwind CSS + zustand
- **包管理**：Go Modules + pnpm
- **构建**：[Task](https://taskfile.dev/) + GitHub Actions

## 🚀 本地开发

### 环境要求

- Go 1.25+
- Node.js 20+ 与 pnpm（`corepack enable`）
- Wails3 CLI：`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
- C 编译器（CGO 需要，go-sqlite3 依赖）：
  - macOS 原生构建：Xcode Command Line Tools
  - Windows 原生构建：[MinGW-w64](https://www.mingw-w64.org/)（gcc）
  - 在 macOS 上交叉编译 Windows EXE：`brew install mingw-w64`（构建任务会自动使用 `x86_64-w64-mingw32-gcc`）

### 常用命令

```bash
# 开发模式（前后端热重载）
wails3 dev -config ./build/config.yml

# 运行测试
go test ./...
cd frontend && pnpm test

# 构建当前平台二进制
wails3 task build

# 打包 macOS DMG（含解除限制脚本与说明）
wails3 task dmg:darwin ARCH=arm64

# 构建 Windows EXE
wails3 task build:windows ARCH=amd64
```

> 修改 Go 服务方法后，需执行 `wails3 generate bindings` 并提交生成的 bindings。

## 🔖 发布构建

发布流程由 GitHub Actions 全自动完成：**推送形如 `v1.2.3` 的标签**即可。

```bash
git tag v1.0.0
git push origin v1.0.0
```

[Release 工作流](.github/workflows/release.yml) 会并行构建 macOS DMG 与 Windows EXE，
版本号取自标签，并自动创建 GitHub Release 上传产物。

## 📂 目录结构

```
internal/
  app/           应用装配、生命周期、平台相关重启逻辑
  config/        跨平台数据/日志目录
  datasource/    外部数据源（eastmoney/tencent/sina/ai），唯一允许发起 HTTP 的层
  scheduler/     交易日历 + 时段状态机 + 轮询任务 + 事件广播
  storage/       SQLite 封装与版本化迁移
  tray/          系统托盘（平台区分图标）
  logger/        文件日志
  version/       版本信息（构建时注入）
services/        Wails 服务层（暴露给前端的 API）
frontend/        React 前端（src/windows 为各窗口入口，bindings 为生成的 TS 绑定）
build/
  darwin/        macOS 打包配置、Info.plist、DMG 脚本与说明
  windows/       Windows 清单、图标与构建配置
docs/            产品/技术/数据源/UI/路线图文档
.github/         CI 与发布工作流、Issue/PR 模板
```

## 📚 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | 各平台安装与首次打开放行指南 |
| [docs/PRD.md](docs/PRD.md) | 产品需求：功能模块、监控时间策略 |
| [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) | 技术设计：架构、多窗口、托盘、存储 schema、事件协议 |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | 数据源调研：接口规格、限频与降级策略 |
| [docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md) | UI 规范：主题 token、组件规范、涨跌色规范 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 迭代计划与任务拆解 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南与开发约定 |

## 🤝 贡献

欢迎提交 Issue 与 Pull Request！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 许可证

本项目基于 [MIT](LICENSE) 协议开源。

## 🙏 致谢

- [Wails](https://wails.io/) —— Go + Web 桌面应用框架
- 天天基金、腾讯财经、新浪财经等公开数据接口
