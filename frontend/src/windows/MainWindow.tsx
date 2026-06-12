import { Search, TrendingUp } from "lucide-react";
import { TitleBar } from "@/components/layout/TitleBar";
import { Button } from "@/components/ui/button";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";

/**
 * 主窗口：完整功能入口。
 * 当前为骨架占位布局（标题栏 + 侧边栏 + 内容区 + 状态栏），
 * 各功能页开发任务见 docs/ROADMAP.md 里程碑 M2。
 */
export function MainWindow() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar>
        {/* 搜索入口占位（M2 实现 Cmd+K 命令面板） */}
        <div className="titlebar-no-drag flex h-[var(--size-input-sm)] w-72 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-2 text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
          <Search size={13} />
          {zhCN.main.searchPlaceholder}
        </div>
      </TitleBar>

      <div className="flex min-h-0 flex-1">
        {/* 侧边栏 */}
        <aside className="vibrancy flex w-[200px] shrink-0 flex-col gap-1 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-[var(--size-padding-sm)]">
          <SidebarItem label="自选监控" active />
          <SidebarItem label="板块行情" />
          <SidebarItem label="基金排行" />
          <SidebarItem label="设置" />
        </aside>

        {/* 内容区：空状态占位 */}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <TrendingUp size={36} className="text-[var(--fg-muted)]" />
          <div className="text-[length:var(--size-font-sm)] text-[var(--fg-secondary)]">
            {zhCN.main.watchlistEmpty}
          </div>
          <Button size="sm">{zhCN.main.watchlistEmptyAction}</Button>
          <div className="mt-2 text-2xs text-[var(--fg-muted)]">
            {zhCN.main.skeletonNotice}
          </div>
          {/* QuoteText 组件示例（涨跌色 token 验证） */}
          <div className="flex gap-3 text-[length:var(--size-font-xs)]">
            <QuoteText value={1.24} />
            <QuoteText value={-0.86} />
            <QuoteText value={0} />
          </div>
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] text-2xs text-[var(--fg-muted)]">
        <span>MiniFund v0.0.1</span>
        <span>数据来源：天天基金（估算值，仅供参考）</span>
      </footer>
    </div>
  );
}

function SidebarItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      className={
        "flex h-[var(--size-btn)] items-center rounded-[var(--radius-btn)] px-3 text-left text-[length:var(--size-font-xs)] " +
        (active
          ? "bg-[var(--sidebar-active)] font-medium text-[var(--sidebar-accent)]"
          : "text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-hover)]")
      }
    >
      {label}
    </button>
  );
}
