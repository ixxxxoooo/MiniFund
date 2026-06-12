import { useEffect, useRef, useState } from "react";
import { ExternalLink, Trash2, Wallet } from "lucide-react";
import type { WatchItem } from "@bindings/minifund/internal/model";
import { WindowService } from "@bindings/minifund/services";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatMoney, formatNav } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

interface WatchlistTableProps {
  /** 点击"持仓"按钮回调（弹出持仓编辑） */
  onEditPosition: (item: WatchItem) => void;
}

/**
 * 自选估值表格：估值/涨跌幅事件驱动刷新，数值变化带闪烁动画。
 */
export function WatchlistTable({ onEditPosition }: WatchlistTableProps) {
  const items = useWatchlistStore((s) => s.items);
  const positions = useWatchlistStore((s) => s.positions);
  const removeFund = useWatchlistStore((s) => s.removeFund);
  const estimates = useMarketStore((s) => s.estimates);
  const updatedAt = useMarketStore((s) => s.estimatesUpdatedAt);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const hideAmounts = useUIStore((s) => s.hideAmounts);

  // 记录上一轮估值，用于判断闪烁方向
  const prevRef = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});

  useEffect(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const [code, est] of Object.entries(estimates)) {
      const prev = prevRef.current[code];
      if (prev != null && est.estimate !== prev) {
        next[code] = est.estimate > prev ? "up" : "down";
      }
      prevRef.current[code] = est.estimate;
    }
    if (Object.keys(next).length > 0) {
      setFlashes(next);
      const timer = window.setTimeout(() => setFlashes({}), 700);
      return () => window.clearTimeout(timer);
    }
  }, [updatedAt, estimates]);

  const hidden = hideAmounts || stealth;
  const cols = zhCN.watchlist.columns;

  return (
    <div className="scroll-always min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="data-grid-header border-b">{cols.name}</th>
            <th className="data-grid-header border-b text-right">{cols.nav}</th>
            <th className="data-grid-header border-b text-right">{cols.estimate}</th>
            <th className="data-grid-header border-b text-right">{cols.growth}</th>
            <th className="data-grid-header border-b text-right">{cols.todayProfit}</th>
            <th className="data-grid-header border-b text-right">{cols.marketValue}</th>
            <th className="data-grid-header border-b text-center">{cols.actions}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const est = estimates[item.code];
            const pos = positions[item.code];
            const flash = flashes[item.code];
            // 当日预估收益 = 份额 ×（估算净值 − 昨日净值）
            const todayProfit =
              pos && est?.hasEstimate ? pos.shares * (est.estimate - est.prevNav) : null;
            const marketValue = pos && est ? pos.shares * (est.hasEstimate ? est.estimate : est.prevNav) : null;

            return (
              <tr
                key={item.code}
                className={cn(
                  "hover:bg-[var(--row-hover)]",
                  flash === "up" && "quote-flash-up",
                  flash === "down" && "quote-flash-down"
                )}
                onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
              >
                <td className="data-grid-cell">
                  <div className="flex flex-col py-0.5">
                    <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">
                      {item.name || est?.name || item.code}
                    </span>
                    <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                  </div>
                </td>
                <td className="data-grid-cell text-right">
                  <div className="flex flex-col items-end py-0.5">
                    <span>{est ? formatNav(est.prevNav) : zhCN.watchlist.noEstimate}</span>
                    <span className="text-2xs text-[var(--fg-muted)]">{est?.navDate ?? ""}</span>
                  </div>
                </td>
                <td className="data-grid-cell text-right">
                  {est?.hasEstimate ? formatNav(est.estimate) : zhCN.watchlist.noEstimate}
                </td>
                <td className="data-grid-cell text-right">
                  {est?.hasEstimate ? (
                    <QuoteText value={est.estimateGrowth} neutral={stealth} />
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  {todayProfit != null ? (
                    <QuoteText value={todayProfit} text={formatMoney(todayProfit, hidden)} neutral={stealth} />
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  {marketValue != null ? formatMoney(marketValue, hidden) : zhCN.watchlist.noEstimate}
                </td>
                <td className="data-grid-cell">
                  <div className="flex items-center justify-center gap-1">
                    <RowAction
                      label={zhCN.watchlist.actionDetail}
                      onClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                    >
                      <ExternalLink size={12} />
                    </RowAction>
                    <RowAction label={zhCN.watchlist.actionPosition} onClick={() => onEditPosition(item)}>
                      <Wallet size={12} />
                    </RowAction>
                    <RowAction
                      label={zhCN.watchlist.actionRemove}
                      onClick={() => {
                        if (window.confirm(zhCN.watchlist.removeConfirm)) {
                          void removeFund(item.code);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </RowAction>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-selected)] hover:text-[var(--fg)]"
    >
      {children}
    </button>
  );
}
