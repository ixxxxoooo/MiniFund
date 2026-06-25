import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Home, RefreshCw, Settings } from "lucide-react";
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
import { computePositionMetrics } from "@/lib/portfolio";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

/**
 * 托盘监控面板：点击托盘图标弹出的无边框置顶小窗（360x600）。
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
    const uninitMarket = initMarket();
    void load();
    void loadBreadth();
    // 面板每次弹出：重新加载自选与涨跌分布（监控估值靠事件流持续推送）
    const unsubShown = onTrayPanelShown(() => {
      void load();
      void loadBreadth();
    });
    return () => {
      uninitMarket();
      unsubShown();
    };
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

  // 列表排序：按涨幅 / 今日增长金额，默认涨幅降序；点击同一项可在降序↔升序间切换。无数据的行恒排末尾。
  const [sortKey, setSortKey] = useState<"growth" | "profit">("growth");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const toggleSort = (key: "growth" | "profit") => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // 当前展示的涨跌幅（与列表渲染口径一致）：盘中估算 → 已公布日涨幅 → 无
  const growthOf = (code: string): number | null => {
    const est = estimates[code];
    if (est?.hasEstimate) return est.estimateGrowth;
    if (est?.hasDayGrowth) return est.dayGrowth;
    return null;
  };
  // 今日收益金额：与自选监控表同口径（computePositionMetrics，含盘后/休市用日涨幅兜底）
  const profitOf = (code: string): number | null =>
    computePositionMetrics(estimates[code], positions[code]).todayProfit;

  const sortedItems = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const valueOf = sortKey === "growth" ? growthOf : profitOf;
    return [...items].sort((a, b) => {
      const va = valueOf(a.code);
      const vb = valueOf(b.code);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // 无数据排末尾
      if (vb == null) return -1;
      return (va - vb) * factor;
    });
    // growthOf/profitOf 依赖 estimates、positions，已显式列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, estimates, positions, sortKey, sortDir]);

  return (
    <div className="flex h-full flex-col gap-[var(--size-gap-sm)] bg-[var(--surface)] p-[var(--size-padding-sm)]">
      {/* 头部：标题 + 监控状态 */}
      <div className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-[length:var(--size-font-xs)] font-semibold text-[var(--fg)]">
          {zhCN.tray.panelTitle}
        </span>
        <span className="truncate text-2xs text-[var(--fg-muted)]">{phaseLabel}</span>
      </div>

      {/* 当日盈亏汇总 + 指数速览 + 涨跌分布 */}
      <div className="shrink-0 rounded-[var(--radius-panel)] bg-[var(--surface-secondary)] p-[var(--size-padding-sm)]">
        <div className="whitespace-nowrap text-2xs text-[var(--fg-muted)]">{zhCN.tray.todayProfit}</div>
        <div className="mt-1 flex items-baseline gap-2 overflow-hidden">
          <span
            className={cn(
              "quote-num whitespace-nowrap text-xl font-semibold",
              // 隐藏金额（含摸鱼模式）时颜色一并中性化：仅隐藏数字会通过红绿背景色泄露涨跌方向，达不到脱敏目的。
              hidden
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

      {/* 分组切换（左，可横向滚动）+ 排序（右）：合并到同一行，节省垂直空间 */}
      {(groups.length > 1 || items.length > 0) && (
        <div className="flex shrink-0 items-center gap-2">
          {groups.length > 1 ? (
            // 容器加纵向内边距，避免 overflow-x-auto 把选中胶囊的上下圆角裁切
            <div className="scroll-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => void setActiveGroup(g.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs outline-none focus:outline-none focus-visible:outline-none",
                    g.id === activeGroupId
                      ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                      : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}

          {/* 排序：按涨幅 / 今日金额，默认涨幅降序；点击同项切换升降序 */}
          {items.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {([
                { key: "growth", label: zhCN.tray.sortGrowth },
                { key: "profit", label: zhCN.tray.sortProfit },
              ] as const).map((opt) => {
                const active = sortKey === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => toggleSort(opt.key)}
                    className={cn(
                      "flex items-center gap-0.5 rounded-[var(--radius-btn)] px-1.5 py-0.5 text-2xs",
                      active
                        ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                        : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                    )}
                  >
                    {opt.label}
                    {active &&
                      (sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 自选估值列表 */}
      <div className="scroll-always flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {sortedItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-2xs text-[var(--fg-muted)]">
            {zhCN.tray.empty}
          </div>
        ) : (
          sortedItems.map((item) => {
            const est = estimates[item.code];
            // 今日收益金额：与自选监控表同口径（含盘后/休市兜底），有持仓才显示
            const todayProfit = computePositionMetrics(est, positions[item.code]).todayProfit;
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
                  {todayProfit != null && (
                    <QuoteText
                      value={todayProfit}
                      text={formatMoney(todayProfit, hidden)}
                      neutral={stealth}
                      className="quote-num whitespace-nowrap text-2xs"
                    />
                  )}
                </div>
                {/* 涨跌幅优先级（与主窗口自选表一致）：
                    盘中实时估算 → 已公布日涨幅（盘后/周末取最近一个交易日） → 无数据「—」 */}
                {est?.hasEstimate ? (
                  <QuoteText
                    value={est.estimateGrowth}
                    neutral={stealth}
                    className="shrink-0 whitespace-nowrap text-2xs"
                  />
                ) : est?.hasDayGrowth ? (
                  <QuoteText
                    value={est.dayGrowth}
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
        <Tooltip content={zhCN.tray.openMain}>
          <button
            aria-label={zhCN.tray.openMain}
            className="rounded-[var(--radius-btn)] p-1.5 text-[var(--accent)] hover:bg-[var(--sidebar-hover)]"
            onClick={() => void call("打开主窗口", () => WindowService.ShowMainWindow())}
          >
            <Home size={13} />
          </button>
        </Tooltip>
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
