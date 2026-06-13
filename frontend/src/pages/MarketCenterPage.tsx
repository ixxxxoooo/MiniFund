import { useEffect, useMemo } from "react";
import type { MarketIndexQuote } from "@bindings/minifund/internal/model";
import { CandleChart } from "@/components/charts/CandleChart";
import { QuoteText } from "@/components/market/QuoteText";
import { Spinner } from "@/components/ui/spinner";
import { useMarketCenterStore, type KlinePeriod } from "@/stores/marketCenter";
import { useSettingsStore } from "@/stores/settings";
import { zhCN } from "@/i18n/zh-CN";
import { cn } from "@/lib/utils";

const PERIODS: { id: KlinePeriod; label: string }[] = [
  { id: "day", label: zhCN.market.period.day },
  { id: "week", label: zhCN.market.period.week },
  { id: "month", label: zhCN.market.period.month },
];

/**
 * 行情中心页：左侧常见 A股/港股/美股指数列表（实时报价，按分组），
 * 右侧为选中指数的 K 线图（日/周/月切换）。数据源东财 push2his（K线）+ ulist.np（实时）。
 */
export function MarketCenterPage() {
  const quotes = useMarketCenterStore((s) => s.quotes);
  const selected = useMarketCenterStore((s) => s.selected);
  const period = useMarketCenterStore((s) => s.period);
  const kline = useMarketCenterStore((s) => s.kline);
  const loadingKline = useMarketCenterStore((s) => s.loadingKline);
  const klineError = useMarketCenterStore((s) => s.klineError);
  const init = useMarketCenterStore((s) => s.init);
  const select = useMarketCenterStore((s) => s.select);
  const setPeriod = useMarketCenterStore((s) => s.setPeriod);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  useEffect(() => {
    init();
  }, [init]);

  // 按分组聚合（保持后端清单顺序）
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, MarketIndexQuote[]>();
    for (const q of quotes) {
      if (!map.has(q.group)) {
        map.set(q.group, []);
        order.push(q.group);
      }
      map.get(q.group)!.push(q);
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [quotes]);

  const selectedQuote = quotes.find((q) => q.secid === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左侧指数列表 */}
      <div className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
        {quotes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.market.quoteEmpty}
          </div>
        ) : (
          groups.map(({ group, items }) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-2xs font-medium text-[var(--fg-muted)]">{group}</div>
              {items.map((q) => (
                <button
                  key={q.secid}
                  onClick={() => select(q.secid)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-[var(--radius-btn)] px-2 py-1.5 text-left",
                    q.secid === selected
                      ? "bg-[var(--sidebar-active)]"
                      : "hover:bg-[var(--sidebar-hover)]"
                  )}
                >
                  <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{q.name}</span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="quote-num text-2xs text-[var(--fg)]">{q.price > 0 ? q.price.toFixed(2) : "—"}</span>
                    <QuoteText value={q.changePercent} neutral={stealth} className="text-2xs" />
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 右侧 K 线区 */}
      <div className="flex min-w-0 flex-1 flex-col p-[var(--size-padding)]">
        {/* 头部：指数名称 + 最新 + 涨跌 + 周期切换 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-[length:var(--size-font-base)] font-semibold text-[var(--fg)]">
              {selectedQuote?.name ?? "—"}
            </span>
            {selectedQuote && selectedQuote.price > 0 && (
              <>
                <span className="quote-num text-[length:var(--size-font-base)] text-[var(--fg)]">
                  {selectedQuote.price.toFixed(2)}
                </span>
                <QuoteText
                  value={selectedQuote.changePercent}
                  neutral={stealth}
                  text={`${selectedQuote.change > 0 ? "+" : ""}${selectedQuote.change.toFixed(2)}  ${selectedQuote.changePercent > 0 ? "+" : ""}${selectedQuote.changePercent.toFixed(2)}%`}
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded-[var(--radius-btn)] px-3 py-1 text-2xs",
                  p.id === period
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--sidebar-hover)]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* K 线图 */}
        <div className="min-h-0 flex-1">
          {loadingKline && kline.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label={zhCN.market.klineLoading} />
            </div>
          ) : klineError && kline.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
              {klineError}
            </div>
          ) : (
            <CandleChart data={kline} height={420} />
          )}
        </div>
      </div>
    </div>
  );
}
