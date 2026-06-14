# 安装与首次打开指南

MiniFund 是免费开源软件，**未购买 Apple / Microsoft 的商业签名与公证证书**，
因此从网络下载后，操作系统会默认拦截。这并非病毒或文件损坏，按下面步骤放行即可。

> 所有产物均由 [GitHub Actions](../.github/workflows/release.yml) 公开自动构建，
> 构建过程可在仓库的 Actions 记录中审计。

---

## macOS（Apple Silicon）

### 1. 安装

1. 从 [Releases](https://github.com/ixxxxoooo/MiniFund/releases) 下载 `MiniFund-<版本>-arm64.dmg`。
2. 双击打开 DMG，将 **MiniFund.app** 拖入「应用程序」文件夹。

### 2. 解除安全限制（二选一）

下载的应用会被打上 `com.apple.quarantine` 隔离标记，首次打开会提示
**「MiniFund 已损坏，无法打开」** 或 **「无法验证开发者」**。

**方式 A（推荐）**：在 DMG 窗口中双击 **「解除安全限制.command」**，按提示完成。

> 若双击无反应，请在「访达」中右键该文件 →「打开」→ 在弹窗中再次「打开」。

**方式 B（手动命令）**：打开「终端」，执行：

```bash
xattr -dr com.apple.quarantine /Applications/MiniFund.app
```

完成后回到「应用程序」双击打开即可。

### 数据与日志位置（macOS）

- 数据库：`~/Library/Application Support/MiniFund/minifund.db`
- 日志：`~/Library/Logs/MiniFund/minifund.log`

---

## Windows 10 / 11（x64）

### 1. 安装

1. 从 [Releases](https://github.com/ixxxxoooo/MiniFund/releases) 下载 `MiniFund-<版本>-windows-amd64.zip`。
2. 解压到任意目录，双击 `MiniFund.exe` 运行（绿色免安装）。

### 2. SmartScreen 拦截

首次运行可能出现蓝色提示 **「Windows 已保护你的电脑」**：

- 点击 **「更多信息」** → **「仍要运行」**。

### 3. WebView2 运行时

程序界面基于 Microsoft Edge WebView2 渲染。Windows 10/11 通常已内置；
若提示缺少，请到微软官网安装
[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（选择 Evergreen Standalone Installer）。

### 数据与日志位置（Windows）

- 数据库：`%AppData%\MiniFund\minifund.db`
- 日志：`%LocalAppData%\MiniFund\logs\minifund.log`

---

## 常见问题

**Q：为什么不做官方签名？**
A：Apple 开发者计划与 Windows 代码签名证书均为收费服务。作为免费开源项目，
目前选择不引入这部分成本；源码与构建脚本完全公开，可自行审阅或自行构建。

**Q：如何自行构建？**
A：参见 [README 的"本地开发"章节](../README.md#-本地开发)。

**Q：卸载后数据还在吗？**
A：数据保存在上述用户目录中，删除应用不会自动清除。如需彻底清理，请手动删除对应的
`MiniFund` 数据与日志目录。
