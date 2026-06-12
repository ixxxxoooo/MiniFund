import { useEffect } from "react";
import { AlertTriangle, BarChart3, LayoutGrid, ListOrdered, Pause, RefreshCw, Search, Settings } from "lucide-react";
import { TitleBar } from "@/components/layout/TitleBar";
import { IndexBar } from "@/components/market/IndexBar";
import { SearchPalette } from "@/components/fund/SearchPalette";
import { Tooltip } from "@/components/ui/tooltip";
import { WatchlistPage } from "@/pages/WatchlistPage";
import { RankingPage } from "@/pages/RankingPage";
import { SectorPage } from "@/pages/SectorPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { zhCN } from "@/i18n/zh-CN";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore, type PageId } from "@/stores/ui";

const NAV_ITEMS: { id: PageId; label: string; icon: React.ReactNode }[] = [
  { id: "watchlist", label: zhCN.nav.watchlist, icon: <LayoutGrid size={14} /> },
  { id: "ranking", label: zhCN.nav.ranking, icon: <ListOrdered size={14} /> },
  { id: "sectors", label: zhCN.nav.sectors, icon: <BarChart3 size={14} /> },
  { id: "settings", label: zhCN.nav.settings, icon: <Settings size={14} /> },
];

/**
 * 主窗口：标题栏（搜索 + 指数行情条）+ 侧边栏导航 + 功能页 + 状态栏。
 */
export function MainWindow() {
  const page = useUIStore((s) => s.page);
  const setPage = useUIStore((s) => s.setPage);
  const setSearchOpen = useUIStore((s) => s.setSearchOpen);
  const initMarket = useMarketStore((s) => s.init);
  const refreshNow = useMarketStore((s) => s.refreshNow);
  const monitor = useMarketStore((s) => s.monitor);
  const degraded = useMarketStore((s) => s.degraded);
  const loadSettings = useSettingsStore((s) => s.load);

  useEffect(() => {
    void loadSettings();
    initMarket();
  }, [loadSettings, initMarket]);

  const phaseLabel = monitor
    ? monitor.paused
      ? zhCN.monitor.paused
      : (zhCN.monitor[monitor.phase as keyof typeof zhCN.monitor] ?? monitor.phase)
    : "";

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar>
        <div className="flex w-full items-center justify-between gap-[var(--size-padding)]">
          {/* 搜索入口（Cmd+K） */}
          <button
            onClick={() => setSearchOpen(true)}
            className="titlebar-no-drag flex h-[var(--size-input-sm)] w-60 shrink-0 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-2 text-2xs text-[var(--fg-muted)] hover:border-[var(--border-color)]"
          >
            <Search size={12} />
            <span className="flex-1 text-left">{zhCN.main.searchPlaceholder}</span>
            <kbd className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-1">⌘K</kbd>
          </button>
          <IndexBar />
        </div>
      </TitleBar>

      <div className="flex min-h-0 flex-1">
        {/* 侧边栏 */}
        <aside className="vibrancy flex w-[160px] shrink-0 flex-col gap-1 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-[var(--size-padding-sm)]">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={cn(
                "flex h-[var(--size-btn)] items-center gap-2 rounded-[var(--radius-btn)] px-3 text-left text-[length:var(--size-font-xs)]",
                page === item.id
                  ? "bg-[var(--sidebar-active)] font-medium text-[var(--sidebar-accent)]"
                  : "text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-hover)]"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </aside>

        {/* 内容区 */}
        <main className="flex min-w-0 flex-1 flex-col">
          {page === "watchlist" && <WatchlistPage />}
          {page === "ranking" && <RankingPage />}
          {page === "sectors" && <SectorPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] text-2xs text-[var(--fg-muted)]">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            {monitor?.paused && <Pause size={10} />}
            {phaseLabel}
            {monitor && !monitor.paused && monitor.nextChange && (
              <span className="text-[var(--fg-muted)]">· {monitor.nextChange}</span>
            )}
          </span>
          {degraded && (
            <span className="flex items-center gap-1 text-[var(--warning)]">
              <AlertTriangle size={10} />
              {zhCN.monitor.degraded}
            </span>
          )}
          <Tooltip content={zhCN.monitor.refreshNow}>
            <button
              aria-label={zhCN.monitor.refreshNow}
              onClick={refreshNow}
              className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--row-hover)] hover:text-[var(--fg)]"
            >
              <RefreshCw size={10} />
            </button>
          </Tooltip>
        </div>
        <span>{zhCN.app.dataDisclaimer}</span>
      </footer>

      <SearchPalette />
    </div>
  );
}
