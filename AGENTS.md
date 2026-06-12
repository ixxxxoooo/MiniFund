# MiniFund 项目代理规则

## 开发前必读

开始任何功能开发前，先阅读 `docs/` 下的对应文档：

- `docs/PRD.md` — 功能需求与监控时间策略
- `docs/TECH_DESIGN.md` — 架构、目录结构、事件协议、存储 schema
- `docs/DATA_SOURCES.md` — 数据源接口规格、限频与降级策略
- `docs/UI_GUIDELINES.md` — UI token 与组件规范（强约束）
- `docs/ROADMAP.md` — 迭代计划与任务拆解

## 代码变更后的验证流程

每次代码变更后，必须在仓库根目录运行适用的检查，全部通过后才能报告完成：

```bash
go test ./...
cd frontend && pnpm test && pnpm build
wails3 generate bindings
wails3 build
```

涉及打包、应用 Bundle 或发布产物的变更，还需：

```bash
wails3 task package:darwin ARCH=arm64
```

构建成功后，重启新构建的实例验证（先停掉旧的 dev/app 实例）：

```bash
wails3 dev
```

如果某条命令在当前环境无法运行，必须明确说明跳过了哪条命令以及原因。

## 硬性规范

1. 所有注释、日志、提交信息一律使用中文。
2. Git 提交信息使用中文 Conventional Commits 格式（`feat: ...` / `fix: ...` / `docs: ...` / `refactor: ...` / `chore: ...`）。
3. 前端样式必须使用 `globals.css` 中的 CSS 变量 token，禁止硬编码颜色与尺寸（详见 `docs/UI_GUIDELINES.md`）。
4. 外部接口请求只允许出现在 `internal/datasource/` 下，前端与 services 层禁止直接发起 HTTP 请求。
5. 涨跌展示必须使用 `--quote-up`/`--quote-down` token 与 `QuoteText` 组件，禁止用 `--danger`/`--success` 表达涨跌。
6. 新增 Go 服务方法后必须执行 `wails3 generate bindings` 并提交生成的 bindings。
7. 修改存储结构必须通过 `internal/storage/migrations.go` 的版本化迁移，禁止直接改表。
