<!-- 感谢贡献！请先阅读 CONTRIBUTING.md。 -->

## 变更说明

<!-- 这个 PR 做了什么？为什么需要它？关联的 Issue（如 Closes #123）。 -->

## 变更类型

- [ ] feat（新功能）
- [ ] fix（缺陷修复）
- [ ] docs（文档）
- [ ] refactor（重构，无功能变化）
- [ ] test（测试）
- [ ] chore（构建/工具/依赖）

## 自检清单

- [ ] `gofmt -l .` 无输出
- [ ] `go vet ./...` 通过
- [ ] `go test ./...` 通过
- [ ] `cd frontend && pnpm test && pnpm build` 通过
- [ ] 如改动 Go 服务方法，已执行 `wails3 generate bindings` 并提交 bindings
- [ ] 如有行为/接口/存储/事件变化，已同步更新 `docs/`
- [ ] 涉及平台相关代码时，已确认 macOS 与 Windows 均可编译

## 截图 / 录屏（如涉及 UI）

<!-- 拖入图片或粘贴 GIF -->
