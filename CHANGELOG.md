# 更新日志

本项目的所有重要变更都会记录在本文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增
- 开源化项目：补充 MIT 许可证、README、贡献指南、安装指南、Issue/PR 模板。
- GitHub Actions：新增 CI（Go 测试/vet/格式 + 前端测试/构建）与发布工作流
  （推送 `v*` 标签时自动构建 macOS DMG 与 Windows EXE 并创建 Release）。
- Windows 跨平台支持：拆分平台相关的进程重启与托盘图标实现，新增
  `build/windows` 构建配置（应用清单、图标、syso 资源）。
- macOS DMG 打包：新增 `dmg:darwin` 任务，DMG 内附「解除安全限制.command」脚本
  与「首次打开必读.txt」说明，便于绕过未公证应用的 Gatekeeper 拦截。

### 变更
- 数据与日志目录改为跨平台实现：macOS 维持原路径，Windows 落到
  `%AppData%` / `%LocalAppData%`。
- 清理仓库内的临时调试文件并完善 `.gitignore`。

<!--
发布新版本时，将「未发布」中的条目移动到对应版本号下，例如：

## [1.0.0] - 2026-xx-xx
-->
