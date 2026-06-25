import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, History, Plus, Search, Trash2, X } from "lucide-react";
import type { FundDetail, FundIndexItem, ProfitHistoryPoint, XrayStock } from "@bindings/minifund/internal/model";
import { FundService, PortfolioService } from "@bindings/minifund/services";
import { BarChart } from "@/components/charts/BarChart";
import { COMPARE_COLORS, MultiLineChart, type CompareSeries } from "@/components/charts/MultiLineChart";
import { PositionStatusBadge } from "@/components/fund/fund-list-helpers";
import { QuoteText } from "@/components/market/QuoteText";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatMoney, formatNav, formatPercent, formatScale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCompareStore, COMPARE_MAX } from "@/stores/compare";
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

// 对比表本地文案（不引入 i18n 改动，集中在此便于维护）
const COMPARE_TEXT = {
  empty: "搜索或从自选中选择 2-6 只基金，对比业绩与净值走势",
  searchPlaceholder: "搜索代码 / 名称 / 拼音",
  searchEmpty: "无匹配基金",
  watchHint: "自选基金",
  tableTitle: "业绩对比",
  chartTitle: "净值收益率走势对比（起点归一化）",
  metric: "指标",
  fund: "基金",
  loading: "加载中…",
  clear: "清空对比",
  transpose: "切换行列",
  history: "历史对比",
  historyEmpty: "暂无历史",
  fundUnit: "只",
};

// 阶段收益行：label 展示名，key 对应 PeriodReturn.period（来自 FundMNPeriodIncrease）
const COMPARE_PERIOD_ROWS: { label: string; key: string }[] = [
  { label: "近1周", key: "Z" },
  { label: "近1月", key: "Y" },
  { label: "近3月", key: "3Y" },
  { label: "近6月", key: "6Y" },
  { label: "近1年", key: "1N" },
  { label: "近2年", key: "2N" },
  { label: "近3年", key: "3N" },
  { label: "今年来", key: "JN" },
  { label: "成立来", key: "LN" },
];

/** 将 PeriodReturns 列表转为 period→value 映射，便于按行取值 */
function periodMap(d: FundDetail): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of d.periodReturns ?? []) m[p.period] = p.value;
  return m;
}

/** 取净值走势最后一条（最新单位净值 + 日期）；无数据返回 null */
function latestNav(d: FundDetail): { nav: number; date: string } | null {
  const t = d.netWorthTrend;
  if (!t || t.length === 0) return null;
  const last = t[t.length - 1];
  return { nav: last.value, date: last.date };
}

/** 申购费率展示：纯数字补 %，已带 % 或空值原样/占位 */
function formatRate(rate: string): string {
  const s = (rate ?? "").trim();
  if (!s) return "—";
  if (s.includes("%")) return s;
  const n = Number(s);
  return Number.isFinite(n) ? `${n}%` : s;
}

/** 对比指标定义：每项返回已格式化的单元格内容，供「列=基金」与「行=基金」两种排布复用 */
function buildMetrics(stealth: boolean): { label: string; cell: (d: FundDetail) => ReactNode }[] {
  const q = (v: number | null) =>
    v == null ? (
      <span className="text-[var(--fg-muted)]">—</span>
    ) : (
      <QuoteText value={v} text={formatPercent(v)} neutral={stealth} />
    );
  return [
    { label: "类型", cell: (d) => d.type || "—" },
    {
      label: "最新净值",
      cell: (d) => {
        const n = latestNav(d);
        return n ? (
          <span className="quote-num">
            {formatNav(n.nav)}
            <span className="ml-1 text-2xs text-[var(--fg-muted)]">{n.date.slice(5)}</span>
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      label: "日增长率",
      cell: (d) => q(latestNav(d) ? d.netWorthTrend[d.netWorthTrend.length - 1].growth : null),
    },
    ...COMPARE_PERIOD_ROWS.map((row) => ({
      label: row.label,
      cell: (d: FundDetail) => {
        const m = periodMap(d);
        return q(row.key in m ? m[row.key] : null);
      },
    })),
    { label: "最大回撤", cell: (d) => q(d.maxDrawdown < 0 ? d.maxDrawdown : null) },
    { label: "基金经理", cell: (d) => d.managers?.[0]?.name || "—" },
    { label: "基金公司", cell: (d) => d.company || "—" },
    { label: "申购费率", cell: (d) => formatRate(d.rate) },
    { label: "规模", cell: (d) => formatScale(Number(d.scale)) },
    { label: "成立日期", cell: (d) => d.estabDate || "—" },
  ];
}

function CompareView() {
  const items = useWatchlistStore((s) => s.items);
  const load = useWatchlistStore((s) => s.load);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  // 对比选择 / 历史持久化在 store：切换菜单或重开窗口后仍保留
  const selected = useCompareStore((s) => s.selected);
  const toggleSel = useCompareStore((s) => s.toggle);
  const removeSel = useCompareStore((s) => s.remove);
  const clearSel = useCompareStore((s) => s.clear);
  const restoreSel = useCompareStore((s) => s.restore);
  const history = useCompareStore((s) => s.history);
  const clearHistory = useCompareStore((s) => s.clearHistory);

  const [details, setDetails] = useState<Record<string, FundDetail>>({});
  const [rangeDays, setRangeDays] = useState(365);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FundIndexItem[]>([]);
  // 业绩对比表排布方向：byFund=列基金/行指标（默认），byMetric=行基金/列指标（横向）
  const [orient, setOrient] = useState<"byFund" | "byMetric">("byFund");
  const pickerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // 补全已选基金详情（含从持久化恢复的选择）；同时清理已移除基金的详情，避免 FundDetail
  // （含完整净值走势数组，可达数百点）长期驻留内存、切批次后持续增长。
  useEffect(() => {
    const selectedSet = new Set(selected);
    setDetails((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const code of Object.keys(next)) {
        if (!selectedSet.has(code)) {
          delete next[code];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    selected.forEach((code) => {
      if (details[code]) return;
      void call("加载对比基金", () => FundService.GetFundDetail(code)).then((d) => {
        if (d) setDetails((prev) => ({ ...prev, [code]: d }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // 搜索（防抖 200ms）；空查询时展示自选
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void call("搜索对比基金", () => FundService.SearchFunds(q, 20, 0)).then((list) => {
        if (list) setResults(list);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // 选基浮窗 / 历史浮窗失焦自动关闭
  useEffect(() => {
    if (!pickerOpen && !historyOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(t)) setPickerOpen(false);
      if (historyOpen && historyRef.current && !historyRef.current.contains(t)) setHistoryOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [pickerOpen, historyOpen]);

  const toggleFund = useCallback(
    (code: string) => {
      toggleSel(code);
      if (!details[code]) {
        void call("加载对比基金", () => FundService.GetFundDetail(code)).then((d) => {
          if (d) setDetails((prev) => ({ ...prev, [code]: d }));
        });
      }
    },
    [details, toggleSel]
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

  // 选基器候选项：有查询走搜索结果，否则展示自选
  const pickerList = query.trim()
    ? results.map((r) => ({ code: r.code, name: r.name }))
    : items.map((it) => ({ code: it.code, name: it.name || it.code }));

  const metrics = useMemo(() => buildMetrics(stealth), [stealth]);

  /** 基金表头单元格（色点 + 名称 + 代码） */
  const fundHeadCell = (code: string, i: number, center: boolean) => {
    const d = details[code];
    return (
      <div className={cn("flex flex-col", center ? "items-center" : "items-start")}>
        <div className="flex items-center gap-1">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
          />
          <span className="truncate" title={d?.name ?? code}>
            {d?.name ?? code}
          </span>
        </div>
        <div className="quote-num text-2xs font-normal text-[var(--fg-muted)]">{code}</div>
      </div>
    );
  };

  const cellOf = (code: string, m: { cell: (d: FundDetail) => ReactNode }) => {
    const d = details[code];
    return d ? m.cell(d) : <span className="text-[var(--fg-muted)]">…</span>;
  };

  return (
    <div className="scroll-always flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] overflow-y-auto">
      {/* 已选基金 chips + 添加（搜索/自选）+ 历史 + 清空 */}
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
                onClick={() => removeSel(code)}
                className="rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                aria-label={zhCN.common.cancel}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <div className="relative" ref={pickerRef}>
          <Tooltip content={selected.length >= COMPARE_MAX ? zhCN.analysis.compareMax : zhCN.analysis.compareAdd}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              disabled={selected.length >= COMPARE_MAX}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border-color)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Plus size={11} />
              {zhCN.analysis.compareAdd}
            </button>
          </Tooltip>
          {pickerOpen && (
            <div className="absolute left-0 top-7 z-20 w-72 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] py-1 shadow-[var(--shadow-md)]">
              <div className="flex items-center gap-1.5 px-2 pb-1">
                <Search size={12} className="shrink-0 text-[var(--fg-muted)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={COMPARE_TEXT.searchPlaceholder}
                  className="w-full bg-transparent py-1 text-2xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
                />
              </div>
              <div className="max-h-52 overflow-y-auto border-t border-[var(--border-subtle)] pt-1">
                {!query.trim() && (
                  <div className="px-3 py-1 text-2xs text-[var(--fg-muted)]">{COMPARE_TEXT.watchHint}</div>
                )}
                {pickerList.length === 0 ? (
                  <div className="px-3 py-2 text-2xs text-[var(--fg-muted)]">
                    {query.trim() ? COMPARE_TEXT.searchEmpty : zhCN.tray.empty}
                  </div>
                ) : (
                  pickerList.map((it) => {
                    const active = selected.includes(it.code);
                    const disabled = !active && selected.length >= COMPARE_MAX;
                    return (
                      <button
                        key={it.code}
                        onClick={() => toggleFund(it.code)}
                        disabled={disabled}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-1 text-left text-2xs hover:bg-[var(--row-hover)] disabled:opacity-40",
                          active ? "text-[var(--accent)]" : "text-[var(--fg)]"
                        )}
                      >
                        <span className="truncate">{it.name}</span>
                        <PositionStatusBadge code={it.code} className="ml-2" />
                        <span className="quote-num ml-2 shrink-0 text-[var(--fg-muted)]">{it.code}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* 历史对比下拉 */}
        <div className="relative" ref={historyRef}>
          <Tooltip content={COMPARE_TEXT.history}>
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <History size={11} />
              {COMPARE_TEXT.history}
            </button>
          </Tooltip>
          {historyOpen && (
            <div className="absolute left-0 top-7 z-20 w-72 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] py-1 shadow-[var(--shadow-md)]">
              {history.length === 0 ? (
                <div className="px-3 py-2 text-2xs text-[var(--fg-muted)]">{COMPARE_TEXT.historyEmpty}</div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 py-1">
                    <span className="text-2xs text-[var(--fg-muted)]">{COMPARE_TEXT.history}</span>
                    <button
                      onClick={() => clearHistory()}
                      className="text-2xs text-[var(--fg-muted)] hover:text-[var(--danger)]"
                    >
                      {zhCN.common.clear}
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto border-t border-[var(--border-subtle)] pt-1">
                    {history.map((batch, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          restoreSel(batch);
                          setHistoryOpen(false);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-2xs text-[var(--fg)] hover:bg-[var(--row-hover)]"
                      >
                        <span className="quote-num text-[var(--fg-secondary)]">
                          {batch.length} {COMPARE_TEXT.fundUnit}
                        </span>
                        <span className="ml-2 quote-num text-[var(--fg-muted)]">{batch.join(" / ")}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <Tooltip content={COMPARE_TEXT.clear}>
            <button
              onClick={() => clearSel()}
              className="flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
            >
              <Trash2 size={11} />
              {COMPARE_TEXT.clear}
            </button>
          </Tooltip>
        )}
      </div>

      {selected.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
          {COMPARE_TEXT.empty}
        </div>
      ) : (
        <>
          {/* 业绩对比表：支持列=基金 / 行=基金 两种排布切换 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
                {COMPARE_TEXT.tableTitle}
              </span>
              <Tooltip content={COMPARE_TEXT.transpose}>
                <button
                  onClick={() => setOrient((o) => (o === "byFund" ? "byMetric" : "byFund"))}
                  className="flex items-center gap-0.5 rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--accent)]"
                >
                  <ArrowLeftRight size={11} />
                  {COMPARE_TEXT.transpose}
                </button>
              </Tooltip>
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface)]">
              {orient === "byFund" ? (
                <table className="w-full border-collapse text-[length:var(--size-font-xs)]">
                  <thead>
                    <tr className="bg-[var(--surface-secondary)]">
                      <th className="sticky left-0 z-10 bg-[var(--surface-secondary)] px-2 py-1.5 text-left font-medium text-[var(--fg-secondary)]">
                        {COMPARE_TEXT.metric}
                      </th>
                      {selected.map((code, i) => (
                        <th key={code} className="min-w-[120px] px-2 py-1.5 text-center font-medium text-[var(--fg)]">
                          {fundHeadCell(code, i, true)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => (
                      <tr key={m.label} className="border-t border-[var(--border-subtle)]">
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] px-2 py-1.5 text-[var(--fg-secondary)]">
                          {m.label}
                        </td>
                        {selected.map((code) => (
                          <td key={code} className="px-2 py-1.5 text-center">
                            {cellOf(code, m)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse text-[length:var(--size-font-xs)]">
                  <thead>
                    <tr className="bg-[var(--surface-secondary)]">
                      <th className="sticky left-0 z-10 bg-[var(--surface-secondary)] px-2 py-1.5 text-left font-medium text-[var(--fg-secondary)]">
                        {COMPARE_TEXT.fund}
                      </th>
                      {metrics.map((m) => (
                        <th key={m.label} className="min-w-[88px] whitespace-nowrap px-2 py-1.5 text-center font-medium text-[var(--fg-secondary)]">
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((code, i) => (
                      <tr key={code} className="border-t border-[var(--border-subtle)]">
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] px-2 py-1.5 text-left">
                          {fundHeadCell(code, i, false)}
                        </td>
                        {metrics.map((m) => (
                          <td key={m.label} className="px-2 py-1.5 text-center">
                            {cellOf(code, m)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selected.some((c) => !details[c]) && (
              <div className="mt-1 text-2xs text-[var(--fg-muted)]">{COMPARE_TEXT.loading}</div>
            )}
          </div>

          {/* 净值收益率走势对比图 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
                {COMPARE_TEXT.chartTitle}
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
            <div className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding)]">
              {series.length >= 1 ? (
                <MultiLineChart series={series} height={300} />
              ) : (
                <div className="flex items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]" style={{ height: 300 }}>
                  {zhCN.analysis.compareEmpty}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
