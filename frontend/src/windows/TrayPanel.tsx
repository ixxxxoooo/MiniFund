import { useEffect } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { Window } from "@wailsio/runtime";
import { WindowService } from "@bindings/minifund/services";
import { BreadthChart } from "@/components/charts/BreadthChart";
import { CopyButton } from "@/components/fund/fund-list-helpers";
import { QuoteText } from "@/components/market/QuoteText";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { onTrayPanelShown } from "@/lib/wails/events";
import { formatMoney, formatPercent } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

/**
 * 托盘监控面板：点击托盘图标弹出的无边框置顶小窗（320x480）。
 * 与主窗口订阅同一事件流；自选/持仓变更与面板弹出时重新加载，保证数据同步。
 */
export function TrayPanel() {
  const initMarket = useMarketStore((s) => s.init);
  const refreshNow = useMarketStore((s) => s.refreshNow);
  const loadBreadth = useMarketStore((s) => s.loadBreadth);
  const estimates = useMarketStore((s) => s.estimates);
  const indexes = useMarketStore((s) => s.indexes);
  const breadth = useMarketStore((s) => s.breadth);
  const monitor = useMarketStore((s) => s.monitor);
  const loadSettings = useSettingsStore((s) => s.load);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const hideAmounts = useUIStore((s) => s.hideAmounts);
  const load = useWatchlistStore((s) => s.load);
  const groups = useWatchlistStore((s) => s.groups);
  const activeGroupId = useWatchlistStore((s) => s.activeGroupId);
  const setActiveGroup = useWatchlistStore((s) => s.setActiveGroup);
  const items = useWatchlistStore((s) => s.items);
  const positions = useWatchlistStore((s) => s.positions);
  const summary = useWatchlistStore((s) => s.summary);

  useEffect(() => {
    void loadSettings();
    initMarket();
    void load();
    void loadBreadth();
    // 面板每次弹出：重新加载自选与涨跌分布（监控估值靠事件流持续推送）
    return onTrayPanelShown(() => {
      void load();
      void loadBreadth();
    });
  }, [loadSettings, initMarket, load, loadBreadth]);

  // Esc 隐藏面板（失焦时系统会自动隐藏，快捷键作为补充）
  useHotkeys({
    escape: () => void Window.Hide(),
  });

  const hidden = hideAmounts || stealth;
  const todayProfit = summary?.todayProfit ?? 0;
  const phaseLabel = monitor
    ? monitor.paused
      ? zhCN.monitor.paused
      : (zhCN.monitor[monitor.phase as keyof typeof zhCN.monitor] ?? monitor.phase)
    : "";

  return (
    <div className="flex h-full flex-col gap-[var(--size-gap)] bg-[var(--surface)] p-[var(--size-padding)]">
      {/* 头部：标题 + 监控状态 */}
      <div className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-[length:var(--size-font-xs)] font-semibold text-[var(--fg)]">
          {zhCN.tray.panelTitle}
        </span>
        <span className="truncate text-2xs text-[var(--fg-muted)]">{phaseLabel}</span>
      </div>

      {/* 当日盈亏汇总 + 指数速览 + 涨跌分布 */}
      <div className="shrink-0 rounded-[var(--radius-panel)] bg-[var(--surface-secondary)] p-[var(--size-padding)]">
        <div className="whitespace-nowrap text-2xs text-[var(--fg-muted)]">{zhCN.tray.todayProfit}</div>
        <div className="mt-1 flex items-baseline gap-2 overflow-hidden">
          <span
            className={cn(
              "quote-num whitespace-nowrap text-xl font-semibold",
              stealth
                ? "text-[var(--quote-flat)]"
                : todayProfit > 0
                  ? "text-[var(--quote-up)]"
                  : todayProfit < 0
                    ? "text-[var(--quote-down)]"
                    : "text-[var(--fg)]"
            )}
          >
            {formatMoney(todayProfit, hidden)}
          </span>
          <QuoteText
            value={summary?.todayPercent ?? 0}
            text={formatPercent(summary?.todayPercent ?? 0)}
            neutral={stealth}
            className="whitespace-nowrap text-[length:var(--size-font-xs)]"
          />
        </div>
        {/* 指数速览（不换行，超出截断） */}
        {indexes.length > 0 && (
          <div className="mt-2 flex items-center gap-3 overflow-hidden border-t border-[var(--border-subtle)] pt-2">
            {indexes.slice(0, 3).map((q) => (
              <div key={q.symbol} className="flex items-center gap-1 whitespace-nowrap text-2xs">
                <span className="text-[var(--fg-secondary)]">{q.name}</span>
                <QuoteText value={q.changePercent} neutral={stealth} />
              </div>
            ))}
          </div>
        )}
        {/* 大盘涨跌分布 */}
        {breadth && (
          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <BreadthChart breadth={breadth} compact />
          </div>
        )}
      </div>

      {/* 分组切换 */}
      {groups.length > 1 && (
        <div className="scroll-none flex shrink-0 items-center gap-1 overflow-x-auto">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => void setActiveGroup(g.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs",
                g.id === activeGroupId
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* 自选估值列表 */}
      <div className="scroll-always flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-2xs text-[var(--fg-muted)]">
            {zhCN.tray.empty}
          </div>
        ) : (
          items.map((item) => {
            const est = estimates[item.code];
            const pos = positions[item.code];
            const profit = pos && est?.hasEstimate ? pos.shares * (est.estimate - est.prevNav) : null;
            return (
              <div
                key={item.code}
                className="group flex items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5 last:border-b-0 hover:bg-[var(--row-hover)]"
                onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-2xs text-[var(--fg)]">{item.name || item.code}</span>
                    <CopyButton value={item.code} name={item.name} />
                  </div>
                  {profit != null && (
                    <span className="quote-num whitespace-nowrap text-2xs text-[var(--fg-muted)]">
                      {formatMoney(profit, hidden)}
                    </span>
                  )}
                </div>
                {est?.hasEstimate ? (
                  <QuoteText
                    value={est.estimateGrowth}
                    neutral={stealth}
                    className="shrink-0 whitespace-nowrap text-2xs"
                  />
                ) : (
                  <span className="shrink-0 text-2xs text-[var(--fg-muted)]">{zhCN.watchlist.noEstimate}</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 底部操作区 */}
      <div className="flex shrink-0 items-center justify-between">
        <button
          className="whitespace-nowrap rounded-[var(--radius-btn)] px-2 py-1 text-[length:var(--size-font-2xs)] text-[var(--accent)] hover:bg-[var(--sidebar-hover)]"
          onClick={() => void call("打开主窗口", () => WindowService.ShowMainWindow())}
        >
          {zhCN.tray.openMain}
        </button>
        <div className="flex items-center gap-1">
          <Tooltip content={zhCN.tray.refresh}>
            <button
              aria-label={zhCN.tray.refresh}
              className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--sidebar-hover)]"
              onClick={refreshNow}
            >
              <RefreshCw size={13} />
            </button>
          </Tooltip>
          <Tooltip content={zhCN.nav.settings}>
            <button
              aria-label={zhCN.nav.settings}
              className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--sidebar-hover)]"
              onClick={() => void call("打开主窗口", () => WindowService.ShowMainWindow())}
            >
              <Settings size={13} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
