import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import type { FundDetail, ProfitHistoryPoint, XrayStock } from "@bindings/minifund/internal/model";
import { FundService, PortfolioService } from "@bindings/minifund/services";
import { BarChart } from "@/components/charts/BarChart";
import { COMPARE_COLORS, MultiLineChart, type CompareSeries } from "@/components/charts/MultiLineChart";
import { QuoteText } from "@/components/market/QuoteText";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

type TabId = keyof typeof zhCN.analysis.tabs;

/**
 * 分析页：收益历史 / 持仓透视 / 基金对比 三个分析工具。
 */
export function AnalysisPage() {
  const [tab, setTab] = useState<TabId>("profit");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      <div className="flex items-center gap-1">
        {(Object.keys(zhCN.analysis.tabs) as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
              t === tab
                ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
            )}
          >
            {zhCN.analysis.tabs[t]}
          </button>
        ))}
      </div>
      {tab === "profit" && <ProfitHistoryView />}
      {tab === "xray" && <XrayView />}
      {tab === "compare" && <CompareView />}
    </div>
  );
}

/* ---------- 收益历史 ---------- */

const PROFIT_DAYS: { key: keyof typeof zhCN.analysis.profitDays; days: number }[] = [
  { key: "d30", days: 30 },
  { key: "d90", days: 90 },
  { key: "d180", days: 180 },
  { key: "d365", days: 365 },
];

function ProfitHistoryView() {
  const hideAmounts = useUIStore((s) => s.hideAmounts);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const [days, setDays] = useState(90);
  const [points, setPoints] = useState<ProfitHistoryPoint[]>([]);

  useEffect(() => {
    void call("加载收益历史", () => PortfolioService.GetProfitHistory(days)).then((list) => {
      if (list) setPoints(list);
    });
  }, [days]);

  const hidden = hideAmounts || stealth;
  const total = useMemo(() => points.reduce((sum, p) => sum + p.profit, 0), [points]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)]">
      <div className="flex items-center justify-between">
        <span className="text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
          {zhCN.analysis.profitTitle}
        </span>
        <div className="flex items-center gap-1">
          {PROFIT_DAYS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDays(d.days)}
              className={cn(
                "rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs",
                d.days === days
                  ? "bg-[var(--row-selected)] text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.analysis.profitDays[d.key]}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
          {zhCN.analysis.profitEmpty}
        </div>
      ) : (
        <div className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding)]">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-2xs text-[var(--fg-muted)]">{zhCN.analysis.profitSum}</span>
            <QuoteText
              value={total}
              text={formatMoney(total, hidden)}
              neutral={stealth}
              className="quote-num text-[length:var(--size-font-base)] font-semibold"
            />
          </div>
          <BarChart
            points={points.map((p) => ({ label: p.date, value: p.profit }))}
            height={220}
            formatValue={(v) => formatMoney(v, hidden)}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 持仓透视 ---------- */

function XrayView() {
  const [stocks, setStocks] = useState<XrayStock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void call("加载持仓透视", () => PortfolioService.GetXray()).then((list) => {
      if (list) {
        setStocks(list);
      } else {
        setFailed(true);
      }
    });
  }, []);

  if (failed) {
    return (
      <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
        {zhCN.analysis.xrayEmpty}
      </div>
    );
  }
  if (stocks == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
        {zhCN.analysis.xrayLoading}
      </div>
    );
  }
  if (stocks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
        {zhCN.analysis.xrayEmpty}
      </div>
    );
  }

  const maxWeight = Math.max(...stocks.map((s) => s.weight), 0.01);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)]">
      <span className="text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">{zhCN.analysis.xrayTitle}</span>
      <div className="scroll-always min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {stocks.map((s) => {
          const open = expanded === s.stockCode;
          return (
            <div key={s.stockCode} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <button
                className="flex w-full items-center gap-2 px-[var(--size-padding)] py-1.5 hover:bg-[var(--row-hover)]"
                onClick={() => setExpanded(open ? null : s.stockCode)}
              >
                {open ? (
                  <ChevronDown size={12} className="shrink-0 text-[var(--fg-muted)]" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 text-[var(--fg-muted)]" />
                )}
                <div className="flex w-44 shrink-0 flex-col items-start">
                  <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{s.stockName}</span>
                  <span className="quote-num text-2xs text-[var(--fg-muted)]">{s.stockCode}</span>
                </div>
                {/* 权重条 */}
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${(s.weight / maxWeight) * 100}%` }}
                  />
                </div>
                <span className="quote-num w-16 shrink-0 text-right text-[length:var(--size-font-xs)] text-[var(--fg)]">
                  {s.weight.toFixed(2)}%
                </span>
                <span className="quote-num w-20 shrink-0 whitespace-nowrap text-right text-2xs text-[var(--fg-muted)]">
                  {s.funds.length} {zhCN.summary.countUnit}
                </span>
              </button>
              {open && (
                <div className="bg-[var(--surface-secondary)] px-[var(--size-padding)] py-2">
                  <div className="mb-1 text-2xs text-[var(--fg-muted)]">{zhCN.analysis.xrayFunds}</div>
                  {s.funds.map((f) => (
                    <div key={f.code} className="flex items-center justify-between py-0.5 text-2xs">
                      <span className="truncate text-[var(--fg-secondary)]">
                        {f.name} <span className="quote-num text-[var(--fg-muted)]">{f.code}</span>
                      </span>
                      <span className="quote-num shrink-0 text-[var(--fg)]">{f.percent.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 基金对比 ---------- */

const COMPARE_RANGES: { key: keyof typeof zhCN.analysis.compareRange; days: number }[] = [
  { key: "m1", days: 30 },
  { key: "m3", days: 91 },
  { key: "m6", days: 182 },
  { key: "y1", days: 365 },
  { key: "y3", days: 1095 },
];

function CompareView() {
  const items = useWatchlistStore((s) => s.items);
  const load = useWatchlistStore((s) => s.load);
  const [selected, setSelected] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, FundDetail>>({});
  const [rangeDays, setRangeDays] = useState(365);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFund = useCallback(
    (code: string) => {
      setSelected((prev) => {
        if (prev.includes(code)) return prev.filter((c) => c !== code);
        if (prev.length >= 6) return prev;
        return [...prev, code];
      });
      // 拉取并缓存详情（净值走势）
      if (!details[code]) {
        void call("加载对比基金", () => FundService.GetFundDetail(code)).then((d) => {
          if (d) setDetails((prev) => ({ ...prev, [code]: d }));
        });
      }
    },
    [details]
  );

  const series = useMemo<CompareSeries[]>(() => {
    const cutoff = new Date(Date.now() - rangeDays * 86400_000).toISOString().slice(0, 10);
    return selected
      .map((code, i) => {
        const d = details[code];
        if (!d) return null;
        const points = (d.netWorthTrend ?? [])
          .filter((p) => p.date >= cutoff)
          .map((p) => ({ date: p.date, value: p.value }));
        return { name: d.name || code, color: COMPARE_COLORS[i % COMPARE_COLORS.length], points };
      })
      .filter((s): s is CompareSeries => s != null && s.points.length >= 2);
  }, [selected, details, rangeDays]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)]">
      <div className="flex items-center justify-between">
        <span className="text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
          {zhCN.analysis.compareTitle}
        </span>
        <div className="flex items-center gap-1">
          {COMPARE_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeDays(r.days)}
              className={cn(
                "rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs",
                r.days === rangeDays
                  ? "bg-[var(--row-selected)] text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.analysis.compareRange[r.key]}
            </button>
          ))}
        </div>
      </div>

      {/* 已选基金 chips + 添加按钮 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((code, i) => {
          const d = details[code];
          return (
            <span
              key={code}
              className="flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--surface-secondary)] py-0.5 pl-2 pr-1 text-2xs text-[var(--fg)]"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
              {d?.name ?? code}
              <button
                onClick={() => toggleFund(code)}
                className="rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                aria-label={zhCN.common.cancel}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <div className="relative">
          <Tooltip content={selected.length >= 6 ? zhCN.analysis.compareMax : zhCN.analysis.compareAdd}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              disabled={selected.length >= 6}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border-color)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Plus size={11} />
              {zhCN.analysis.compareAdd}
            </button>
          </Tooltip>
          {pickerOpen && (
            <div className="absolute left-0 top-7 z-20 max-h-56 w-64 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] py-1 shadow-[var(--shadow-md)]">
              {items.length === 0 ? (
                <div className="px-3 py-2 text-2xs text-[var(--fg-muted)]">{zhCN.tray.empty}</div>
              ) : (
                items.map((it) => (
                  <button
                    key={it.code}
                    onClick={() => toggleFund(it.code)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-1 text-left text-2xs hover:bg-[var(--row-hover)]",
                      selected.includes(it.code) ? "text-[var(--accent)]" : "text-[var(--fg)]"
                    )}
                  >
                    <span className="truncate">{it.name || it.code}</span>
                    <span className="quote-num ml-2 shrink-0 text-[var(--fg-muted)]">{it.code}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 对比图 */}
      <div className="min-h-0 flex-1 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding)]">
        {series.length >= 1 ? (
          <MultiLineChart series={series} height={300} />
        ) : (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.analysis.compareEmpty}
          </div>
        )}
      </div>
    </div>
  );
}
