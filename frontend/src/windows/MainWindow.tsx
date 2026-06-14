import { useEffect } from "react";
import { AlertTriangle, BarChart3, CandlestickChart, LayoutGrid, LineChart, ListOrdered, Newspaper, Pause, RefreshCw, Search, Settings } from "lucide-react";
import { TitleBar } from "@/components/layout/TitleBar";
import { IndexBar } from "@/components/market/IndexBar";
import { SearchPalette } from "@/components/fund/SearchPalette";
import { Tooltip } from "@/components/ui/tooltip";
import { MarketCenterPage } from "@/pages/MarketCenterPage";
import { WatchlistPage } from "@/pages/WatchlistPage";
import { SearchPage } from "@/pages/SearchPage";
import { AnalysisPage } from "@/pages/AnalysisPage";
import { RankingPage } from "@/pages/RankingPage";
import { SectorPage } from "@/pages/SectorPage";
import { NewsPage } from "@/pages/NewsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { WindowService } from "@bindings/minifund/services";
import { useMarketStore } from "@/stores/market";
import { useNewsStore } from "@/stores/news";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore, type PageId } from "@/stores/ui";

const NAV_ITEMS: { id: PageId; label: string; icon: React.ReactNode }[] = [
  { id: "market", label: zhCN.nav.market, icon: <CandlestickChart size={14} /> },
  { id: "watchlist", label: zhCN.nav.watchlist, icon: <LayoutGrid size={14} /> },
  { id: "search", label: zhCN.nav.search, icon: <Search size={14} /> },
  { id: "analysis", label: zhCN.nav.analysis, icon: <LineChart size={14} /> },
  { id: "ranking", label: zhCN.nav.ranking, icon: <ListOrdered size={14} /> },
  { id: "sectors", label: zhCN.nav.sectors, icon: <BarChart3 size={14} /> },
  { id: "news", label: zhCN.nav.news, icon: <Newspaper size={14} /> },
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
  const initNews = useNewsStore((s) => s.init);
  const newsUnread = useNewsStore((s) => s.unread);
  const markNewsRead = useNewsStore((s) => s.markRead);

  useEffect(() => {
    void loadSettings();
    initMarket();
    const unsub = initNews();
    return unsub;
  }, [loadSettings, initMarket, initNews]);

  // 进入快讯页即清除未读红点
  useEffect(() => {
    if (page === "news") markNewsRead();
  }, [page, markNewsRead]);

  // 全局快捷键：⌘K 搜索、⌘R 刷新、⌘1-5 切页、⌘W 隐藏主窗口（与系统行为一致）
  useHotkeys({
    "meta+k": () => setSearchOpen(true),
    "meta+r": () => refreshNow(),
    "meta+w": () => void call("隐藏主窗口", () => WindowService.HideMainWindow()),
    ...Object.fromEntries(
      NAV_ITEMS.map((item, i) => [`meta+${i + 1}`, () => setPage(item.id)])
    ),
  });

  const phaseLabel = monitor
    ? monitor.paused
      ? zhCN.monitor.paused
      : (zhCN.monitor[monitor.phase as keyof typeof zhCN.monitor] ?? monitor.phase)
    : "";

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar>
        <div className="flex w-full items-center justify-between gap-[var(--size-padding)]">
          {/* 应用名称（搜索入口已收敛到侧边栏「搜索」页） */}
          <span className="flex shrink-0 items-center gap-1.5 text-[length:var(--size-font-sm)] font-semibold text-[var(--fg)]">
            <CandlestickChart size={14} className="text-[var(--accent)]" />
            {zhCN.app.name}
          </span>
          {/* 指数行情条占据剩余宽度并可收缩，内部横向滚动展示全部已选指数 */}
          <div className="flex min-w-0 flex-1 justify-end">
            <IndexBar />
          </div>
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
              <span className="flex-1">{item.label}</span>
              {item.id === "news" && newsUnread > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-2xs font-medium text-[var(--accent-fg)]">
                  {newsUnread > 99 ? "99+" : newsUnread}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* 内容区 */}
        <main className="flex min-w-0 flex-1 flex-col">
          {page === "market" && <MarketCenterPage />}
          {page === "watchlist" && <WatchlistPage />}
          {/* 搜索页常驻挂载、非激活时隐藏：切走再回来时上次的关键字与结果仍在 */}
          <SearchPage visible={page === "search"} />
          {page === "analysis" && <AnalysisPage />}
          {page === "ranking" && <RankingPage />}
          {page === "sectors" && <SectorPage />}
          {page === "news" && <NewsPage />}
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
