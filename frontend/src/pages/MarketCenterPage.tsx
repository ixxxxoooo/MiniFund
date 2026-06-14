import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketIndexQuote } from "@bindings/minifund/internal/model";
import { CandleChart } from "@/components/charts/CandleChart";
import { QuoteText } from "@/components/market/QuoteText";
import { Spinner } from "@/components/ui/spinner";
import { useMarketCenterStore, type KlinePeriod } from "@/stores/marketCenter";
import { useSettingsStore } from "@/stores/settings";
import { zhCN } from "@/i18n/zh-CN";
import { quoteDirection } from "@/lib/format";
import { cn } from "@/lib/utils";

const PERIODS: { id: KlinePeriod; label: string }[] = [
  { id: "day", label: zhCN.market.period.day },
  { id: "week", label: zhCN.market.period.week },
  { id: "month", label: zhCN.market.period.month },
];

/**
 * 指数点位/数值的着色类：随涨跌方向与涨跌幅同色（红涨绿跌跟随 token）。
 * stealth（摸鱼模式）下统一中性色，不暴露涨跌。
 */
function priceColorClass(changePercent: number, stealth: boolean): string {
  if (stealth) return "text-[var(--quote-flat)]";
  const dir = quoteDirection(changePercent);
  if (dir === "up") return "text-[var(--quote-up)]";
  if (dir === "down") return "text-[var(--quote-down)]";
  return "text-[var(--quote-flat)]";
}

/** 成交量友好格式化（亿/万）。 */
function formatVol(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

/**
 * 行情中心页：左侧常见 A股/港股/美股指数列表（实时报价，按分组），
 * 右侧为选中指数的行情头卡 + 当日 OHLC 概览 + K 线图（日/周/月切换，高度随窗口自适应）。
 * 数据源：实时报价腾讯（稳定全覆盖）；K 线 A股/港股腾讯、美股/北证 50 东财兜底。
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

  // K 线区高度随容器自适应（窗口缩放时图表跟随，保证蜡烛清晰、占满空间）。
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartH, setChartH] = useState(380);
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setChartH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const latest = kline.length > 0 ? kline[kline.length - 1] : null;
  // 头卡涨跌方向取实时涨跌幅，无实时则回退最新一根 K 线
  const headPct = selectedQuote?.changePercent ?? latest?.changePercent ?? 0;

  const stats: { label: string; value: string }[] = latest
    ? [
        { label: zhCN.market.stat.open, value: latest.open.toFixed(2) },
        { label: zhCN.market.stat.high, value: latest.high.toFixed(2) },
        { label: zhCN.market.stat.low, value: latest.low.toFixed(2) },
        { label: zhCN.market.stat.volume, value: formatVol(latest.volume) },
      ]
    : [];

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左侧指数列表 */}
      <div className="flex w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-[var(--size-padding-sm)]">
        {quotes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.market.quoteEmpty}
          </div>
        ) : (
          groups.map(({ group, items }) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-2xs font-semibold tracking-wide text-[var(--fg-muted)]">{group}</div>
              {items.map((q) => {
                const active = q.secid === selected;
                return (
                  <button
                    key={q.secid}
                    onClick={() => select(q.secid)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-2 rounded-[var(--radius-btn)] px-2 py-1.5 text-left transition-colors",
                      active
                        ? "bg-[var(--sidebar-active)]"
                        : "hover:bg-[var(--sidebar-hover)]"
                    )}
                  >
                    <span
                      className={cn(
                        "truncate text-[length:var(--size-font-xs)]",
                        active ? "font-medium text-[var(--fg)]" : "text-[var(--fg-secondary)]"
                      )}
                    >
                      {q.name}
                    </span>
                    <span className="flex shrink-0 flex-col items-end leading-tight">
                      <span className={cn("quote-num text-2xs", priceColorClass(q.changePercent, stealth))}>
                        {q.price > 0 ? q.price.toFixed(2) : "—"}
                      </span>
                      <QuoteText value={q.changePercent} neutral={stealth} className="text-2xs" />
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* 右侧行情区 */}
      <div className="flex min-w-0 flex-1 flex-col p-[var(--size-padding)]">
        {/* 头卡：名称 + 分组标签 + 最新点位/涨跌 + 周期切换 */}
        <div className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[length:var(--size-font-base)] font-semibold text-[var(--fg)]">
                {selectedQuote?.name ?? zhCN.market.title}
              </span>
              {selectedQuote && (
                <span className="rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-1.5 py-0.5 text-2xs text-[var(--fg-muted)]">
                  {selectedQuote.group}
                </span>
              )}
            </div>
            {selectedQuote && selectedQuote.price > 0 ? (
              <div className="flex items-baseline gap-3">
                <span className={cn("quote-num text-xl font-semibold leading-none", priceColorClass(headPct, stealth))}>
                  {selectedQuote.price.toFixed(2)}
                </span>
                <QuoteText
                  value={headPct}
                  neutral={stealth}
                  className="quote-num text-[length:var(--size-font-sm)]"
                  text={`${selectedQuote.change > 0 ? "+" : ""}${selectedQuote.change.toFixed(2)}  ${selectedQuote.changePercent > 0 ? "+" : ""}${selectedQuote.changePercent.toFixed(2)}%`}
                />
              </div>
            ) : (
              <span className="text-2xs text-[var(--fg-muted)]">{zhCN.market.selectHint}</span>
            )}
          </div>

          {/* 周期切换：分段控件 */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-btn)] bg-[var(--surface-secondary)] p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-3 py-1 text-2xs transition-colors",
                  p.id === period
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--fg-secondary)] hover:text-[var(--fg)]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 当日 OHLC 概览 */}
        {stats.length > 0 && (
          <div className="mb-2 flex shrink-0 flex-wrap gap-x-6 gap-y-1">
            {stats.map((s) => (
              <span key={s.label} className="flex items-baseline gap-1 text-2xs">
                <span className="text-[var(--fg-muted)]">{s.label}</span>
                <span className="quote-num text-[var(--fg)]">{s.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* K 线图（高度自适应容器） */}
        <div ref={chartWrapRef} className="min-h-0 flex-1 overflow-hidden">
          {loadingKline && kline.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label={zhCN.market.klineLoading} />
            </div>
          ) : klineError && kline.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
              {klineError}
            </div>
          ) : (
            <CandleChart data={kline} height={Math.max(240, chartH - 40)} />
          )}
        </div>
      </div>
    </div>
  );
}
