# 贡献指南

感谢你对 MiniFund 的关注！欢迎以 Issue、Pull Request 等形式参与改进。

## 开始之前

请先阅读 `docs/` 下的文档了解项目：

- [docs/PRD.md](docs/PRD.md) —— 产品需求与监控时间策略
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) —— 架构、目录结构、事件协议、存储 schema
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) —— 数据源接口规格、限频与降级策略
- [docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md) —— UI token 与组件规范（强约束）
- [AGENTS.md](AGENTS.md) —— 开发验证流程汇总

## 开发环境

- Go 1.25+
- Node.js 20+ 与 pnpm（`corepack enable`）
- Wails3 CLI：`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
- C 编译器（CGO）：macOS 用 Xcode Command Line Tools；Windows 用 MinGW-w64

```bash
# 开发模式
wails3 dev -config ./build/config.yml
```

## 提交前自检

提交 PR 前请确保以下检查通过（CI 也会执行）：

```bash
gofmt -l .          # 应无输出
go vet ./...
go test ./...
cd frontend && pnpm test && pnpm build
```

## 编码约定（硬性规范）

1. **中文优先**：所有代码注释、日志文案、文档、UI 文案一律使用中文。
2. **架构边界**：外部 HTTP 请求**只允许**出现在 `internal/datasource/` 子包中；
   `services/` 与前端禁止直连外部接口。
3. **数据流**：写操作必须 前端 bindings → Go 落库 → Go 发事件 → 各窗口 store 更新；
   禁止前端先改本地状态再同步。周期性数据由 `internal/scheduler` 统一拉取并广播，
   前端禁止自行 `setInterval` 轮询 bindings。
4. **样式 token**：前端样式必须使用 `globals.css` 中的 CSS 变量 token，禁止硬编码颜色与尺寸。
   涨跌展示必须使用 `--quote-up` / `--quote-down` 与 `QuoteText` 组件。
5. **bindings**：新增/修改 Go 服务方法后必须执行 `wails3 generate bindings` 并提交生成的 bindings。
6. **存储迁移**：修改存储结构必须通过 `internal/storage/migrations.go` 的版本化迁移，禁止直接改表。
7. **跨平台**：涉及系统调用、文件路径、托盘等平台相关代码，请使用构建标签
   （`//go:build`）拆分平台实现，确保 macOS 与 Windows 均可编译。

## Git 提交信息

使用**中文 Conventional Commits**格式，一次提交只做一件事：

```
feat: 新增基金对比视图
fix: 修复盘中估值并发拉取的竞态
docs: 补充 Windows 安装说明
refactor: 抽取调度器时段状态机
test: 补充新浪 K 线解析用例
chore: 升级前端依赖
```

## Pull Request

1. 从 `main` 切出特性分支。
2. 保持提交粒度清晰，附上必要的说明与测试。
3. 行为变化请同步更新 `docs/PRD.md`；接口/存储/事件变化请同步更新 `docs/TECH_DESIGN.md`；
   新增外部接口请先在 `docs/DATA_SOURCES.md` 登记接口规格与限频策略。
4. 确保 CI 全绿后再请求 Review。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
