# MiniFund UI 风格与组件规范

> 版本：v1.0 ｜ 更新日期：2026-06-12
>
> 设计语言提炼自 MiniDB 项目：macOS 原生质感、CSS 变量主题系统、紧凑信息密度。
> 本文是前端开发的强约束规范，所有组件必须遵守。

## 1. 设计原则

1. **macOS 原生感**：系统字体（SF Pro）、毛玻璃、frameless 圆角窗口、自绘红绿灯按钮。
2. **Token 优先**：颜色、圆角、尺寸一律使用 CSS 变量 token，**禁止硬编码色值和像素**（图表库配置等无法使用 CSS 变量处除外，需读取 token 计算值）。
3. **信息密度高但不拥挤**：行情类界面采用紧凑行高 + 等宽数字字体，留白靠 `--size-gap`/`--size-padding` 控制。
4. **低打扰**：动画短（≤ 0.2s）、滚动条自动隐藏、变化用轻量闪烁而非弹窗。

## 2. 主题系统（CSS 变量）

主题定义在 `frontend/src/globals.css`，结构与 MiniDB 完全一致：`:root` 亮色 + `.dark` 暗色 + `.compact` 紧凑尺寸覆盖。

### 2.1 核心 Token（沿用 MiniDB）

| 类别 | Token | 亮色值 | 暗色值 |
| --- | --- | --- | --- |
| 主色 | `--accent` / `--accent-hover` / `--accent-fg` | `#007aff` / `#0066d6` / `#fff` | `#0a84ff` / `#409cff` / `#fff` |
| 表面 | `--surface` / `--surface-secondary` / `--surface-elevated` | `#fff` / `#f5f5f7` / `#fff` | `#252626` / `#363636` / `#464646` |
| 前景 | `--fg` / `--fg-secondary` / `--fg-muted` | `#1d1d1f` / `#6e6e73` / `#aeaeb2` | `#f5f5f7` / `#b8b8be` / `#8a8a90` |
| 边框 | `--border-color` / `--border-subtle` | `#d2d2d7` / `#e5e5ea` | `#5a5a5a` / `#4a4a4a` |
| 状态 | `--success` / `--warning` / `--danger` / `--info` | `#34c759` / `#ff9500` / `#ff3b30` / `#5ac8fa` | `#30d158` / `#ff9f0a` / `#ff453a` / `#64d2ff` |
| 侧边栏 | `--sidebar-bg` / `--sidebar-hover` / `--sidebar-active` | 见 globals.css | 见 globals.css |

### 2.2 圆角与尺寸 Token

```
--radius-window: 12px   --radius-panel: 12px   --radius-btn: 7px
--radius-input: 8px     --radius-menu: 8px     --radius-sm: 4px

--size-toolbar: 36px    --size-btn: 28px       --size-btn-sm: 24px
--size-input: 32px      --size-tab: 28px
--size-font-base: 15px  --size-font-sm: 14px   --size-font-xs: 13px  --size-font-2xs: 12px
--size-gap: 8px         --size-padding: 12px
```

- `.compact` 类整体缩小一级（详见 globals.css），布局结构不变。

### 2.3 行情专用 Token（MiniFund 新增）

```css
:root {
  /* 涨跌色 — 默认红涨绿跌（A 股习惯），由 settings 切换为 .scheme-intl 时反转 */
  --quote-up: #f5222d;
  --quote-down: #00a850;
  --quote-flat: var(--fg-secondary);
  --quote-up-bg: rgba(245, 34, 45, 0.10);    /* 闪烁/徽标背景 */
  --quote-down-bg: rgba(0, 168, 80, 0.10);
}
.dark {
  --quote-up: #ff6b6b;
  --quote-down: #2fd47a;
  --quote-up-bg: rgba(255, 107, 107, 0.14);
  --quote-down-bg: rgba(47, 212, 122, 0.14);
}
/* 国际配色：绿涨红跌，由根节点附加 .scheme-intl 切换 */
.scheme-intl { --quote-up: #00a850; --quote-down: #f5222d; /* bg 同步对调 */ }
```

规范：

- 涨跌数值**必须**用 `--quote-up`/`--quote-down`/`--quote-flat`，禁止直接用 `--danger`/`--success`（语义不同：danger 表错误，quote-up 表上涨）。
- 主题/概念标签用分类色票 `--chip-{0..5}-bg`/`--chip-{0..5}-fg`（亮/暗各一套），由标签名哈希稳定取色；**刻意规避红/绿**，避免与涨跌色混淆。
- 涨跌数字统一等宽字体 `var(--font-mono)` + `font-variant-numeric: tabular-nums`，避免刷新时抖动。
- 涨显示 `+1.24%`、跌显示 `-0.86%`、平显示 `0.00%`；金额千分位分隔。
- 摸鱼模式：全部使用 `--quote-flat`，去掉正负号与箭头。

## 3. 窗口与布局规范

### 3.1 Frameless 窗口

- `html`/`body` 透明，`#root` 承载背景色 + `border-radius: var(--radius-window)` + inset 描边（`--window-border`），写法照搬 MiniDB globals.css。
- 标题栏自绘：高度 `--size-toolbar`，类 `.titlebar-drag` 可拖拽，交互元素加 `.titlebar-no-drag`；macOS 红绿灯自绘按钮（关闭=隐藏到托盘）。

### 3.2 主窗口布局

```
┌────────────────────────────────────────────┐
│ 标题栏（拖拽区 + 红绿灯 + 搜索入口 + 指数行情条） │
├──────────┬─────────────────────────────────┤
│ 侧边栏    │ 内容区                            │
│ 自选分组  │  - 自选监控表格（默认）             │
│ 板块     │  - 板块/排行                       │
│ 排行     │  - 基金详情面板                    │
│ 设置     │                                  │
├──────────┴─────────────────────────────────┤
│ 状态栏（监控状态徽标 · 数据时间 · 降级提示）      │
└────────────────────────────────────────────┘
```

- 侧边栏：宽 200px（可折叠至 56px 图标态），背景 `--sidebar-bg` + `.vibrancy` 毛玻璃。
- 状态栏：高 24px，字号 `--size-font-2xs`。

### 3.3 托盘面板（320×420）

- 结构：盈亏汇总卡片（上）→ 自选紧凑列表（中，行高 28px）→ 指数条 + 操作入口（下）。
- 无标题栏不可拖拽；圆角 `--radius-panel`；出现动画 `fade-in 0.15s`。

## 4. 组件规范

### 4.1 通用组件写法（对齐 MiniDB）

- 组件放 `components/ui/`，命名小写文件（`button.tsx`），导出 PascalCase。
- 使用 `React.forwardRef` + `cn()`（clsx + tailwind-merge）合并类名。
- variant/size 用条件类名对象（MiniDB Button 模式），样式值全部引用 token：

```tsx
// 示例：variant 样式必须引用 CSS 变量
"bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
"h-[var(--size-btn)] px-3 text-[length:var(--size-font-sm)]"
```

- 基础组件清单（v1）：`button`、`input`、`badge`、`tooltip`、`dialog`、`dropdown-menu`、`switch`、`tabs`、`context-menu`（Radix 封装）。

### 4.2 行情业务组件

| 组件 | 规范 |
| --- | --- |
| `QuoteText` | 涨跌文本统一出口：传入数值，内部处理符号/颜色/摸鱼模式/tabular-nums |
| `QuoteBadge` | 涨跌徽标（指数条用）：背景 `--quote-*-bg`，圆角 `--radius-sm` |
| `FundTable` | 自选表格：表头 `data-grid-header`、单元格 `data-grid-cell` 样式类（沿用 MiniDB 表格规范）；行 hover `--row-hover`，选中 `--row-selected` |
| `FlashCell` | 数值变化闪烁：背景从 `--quote-up-bg`/`--quote-down-bg` 渐隐 0.6s |
| `ProfitCard` | 盈亏汇总卡片：大数字 `--size-font-base`×1.6 加粗，支持金额隐藏态 `****` |
| `TrendChart` | 净值走势图：颜色从 token 读取计算值；网格线 `--border-subtle` |

### 4.3 交互细节

- 按钮按压反馈：`scale(0.98) + opacity 0.92`（globals.css 全局规则，沿用）。
- 全局禁止文本选择，数据单元格、输入框例外（沿用 MiniDB `#root *` 规则）。
- 滚动条：自动隐藏方案沿用；数据表格区加 `.scroll-always`。
- Toast：右上角滑入（`slide-in-right 0.2s`），错误用 `--danger`，4s 自动消失。
- 空状态：图标 + 一句话 + 主操作按钮（如"搜索添加第一只基金"）。

## 5. 字体与数字

- 界面字体：`-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`。
- 数字/代码：`var(--font-mono)`（SF Mono 系列），所有净值、涨跌幅、金额、基金代码必须等宽。
- 金额格式：`¥12,345.67`；万元以上可缩写 `¥1.23万`（列表中），详情页展示完整值。

## 6. 图表规范

- 折线图：单位净值主线用 `--accent`；对比线（沪深300/同类）用 `--fg-muted` 与 `--info`；面积渐变透明度 ≤ 0.15。
- 饼图（资产配置）：从 `--accent`/`--info`/`--warning`/`--fg-muted` 取色。
- 提示框（tooltip）：背景 `--surface-elevated`、阴影 `--shadow-md`、圆角 `--radius-menu`。
- 坐标轴文字 `--fg-muted`、字号 11px；横轴只显示首尾与关键刻度。
- K 线图（行情中心，唯一引入图表库的例外）：用 `klinecharts`（v9），样式经 `KlineChart.tsx` 的 `buildStyles` **读取 token 计算值**映射（涨跌 `--quote-up/--quote-down`、平盘 `--fg-secondary`、网格/轴线 `--border-color`、轴文字 `--fg-muted`、MA 线 `--accent/--warning/--info`、tooltip 背景 `--surface-elevated`），随明暗主题/涨跌色方案/摸鱼模式实时重应用；**不得硬编码色值**。

## 7. 可访问性与多主题验证

- 每个新组件必须在亮色、暗色、紧凑三种模式下自查。
- 焦点环：`focus-visible:ring-2 ring-[var(--accent)]`（沿用 MiniDB Button 规范）。
- `prefers-reduced-motion: reduce` 时关闭闪烁与滚动动画。
