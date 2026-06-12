import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Window } from "@wailsio/runtime";
import type { FundDetail, NavPage } from "@bindings/minifund/internal/model";
import { FundService } from "@bindings/minifund/services";
import { LineChart } from "@/components/charts/LineChart";
import { TitleBar } from "@/components/layout/TitleBar";
import { QuoteText } from "@/components/market/QuoteText";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/ui/sortable-header";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav } from "@/lib/format";
import { useLocalSort } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";

/** 历史净值每页条数 */
const NAV_PAGE_SIZE = 10;

/** 将规模原始字符串（元）格式化为亿元 */
function formatScale(raw: string): string {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return "";
  return (v / 1e8).toFixed(2) + zhCN.detail.tags.scaleUnit;
}

interface DetailWindowProps {
  /** 基金代码，来自 hash 路由 /#/detail/{code} */
  code: string;
}

type RangeKey = keyof typeof zhCN.detail.ranges;

/** 各时间档对应的交易日数量（全部为 Infinity） */
const RANGE_DAYS: Record<RangeKey, number> = {
  m1: 22,
  m3: 66,
  m6: 132,
  y1: 250,
  y3: 750,
  all: Infinity,
};

/**
 * 基金详情独立窗口：净值走势图 + 重仓股 + 基金经理 + 历史净值。
 */
export function DetailWindow({ code }: DetailWindowProps) {
  const initMarket = useMarketStore((s) => s.init);
  const estimates = useMarketStore((s) => s.estimates);
  const loadSettings = useSettingsStore((s) => s.load);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  const [detail, setDetail] = useState<FundDetail | null>(null);
  const [navPage, setNavPage] = useState<NavPage | null>(null);
  const [navIndex, setNavIndex] = useState(1);
  const [navLoading, setNavLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>("y1");

  useEffect(() => {
    void loadSettings();
    initMarket();
    void call("加载基金详情", () => FundService.GetFundDetail(code)).then((d) => {
      if (d) {
        setDetail(d);
      } else {
        setFailed(true);
      }
    });
  }, [code, loadSettings, initMarket]);

  // 历史净值分页加载
  useEffect(() => {
    setNavLoading(true);
    void call("加载历史净值", () => FundService.GetNavHistory(code, navIndex, NAV_PAGE_SIZE)).then((p) => {
      setNavLoading(false);
      if (p) setNavPage(p);
    });
  }, [code, navIndex]);

  const est = estimates[code];

  // 按时间档截取净值走势
  const chartPoints = useMemo(() => {
    const trend = detail?.netWorthTrend ?? [];
    const days = RANGE_DAYS[range];
    const slice = days === Infinity ? trend : trend.slice(-days);
    return slice.map((p) => ({ date: p.date, value: p.value }));
  }, [detail, range]);

  const latest = detail?.netWorthTrend?.[detail.netWorthTrend.length - 1];

  // 历史净值当前页本地排序
  const navSort = useLocalSort(navPage?.items ?? [], {
    date: (r) => r.date,
    nav: (r) => r.nav,
    accNav: (r) => r.accNav,
    growth: (r) => r.growth,
  });
  const navTotalPages = navPage ? Math.max(1, Math.ceil(navPage.total / NAV_PAGE_SIZE)) : 1;

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar onClose={() => void Window.Close()}>
        <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
          {detail?.name ?? code}
          <span className="quote-num ml-2 text-[var(--fg-muted)]">{code}</span>
        </span>
      </TitleBar>

      {failed ? (
        <main className="flex flex-1 items-center justify-center text-[length:var(--size-font-sm)] text-[var(--fg-muted)]">
          {zhCN.detail.loadFailed}
        </main>
      ) : !detail ? (
        <main className="flex flex-1 items-center justify-center text-[length:var(--size-font-sm)] text-[var(--fg-muted)]">
          {zhCN.detail.loading}
        </main>
      ) : (
        <main className="scroll-always flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] overflow-y-auto p-[var(--size-padding)]">
          {/* 头部信息 */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--size-font-base)] font-semibold text-[var(--fg)]">
                  {detail.name}
                </span>
                {detail.rate && <Badge variant="secondary">{zhCN.detail.rate} {detail.rate}%</Badge>}
              </div>
              {/* 标签行：类型 / 公司 / 跟踪指数 / 风险等级 / 规模 / 成立日期 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {detail.type && <Badge variant="secondary">{detail.type}</Badge>}
                {detail.company && <Badge variant="secondary">{detail.company}</Badge>}
                {detail.indexName && (
                  <Badge variant="secondary">
                    {zhCN.detail.tags.index} {detail.indexName}
                  </Badge>
                )}
                {detail.riskLevel && zhCN.detail.tags.riskLevels[detail.riskLevel as keyof typeof zhCN.detail.tags.riskLevels] && (
                  <Badge variant="warning">
                    {zhCN.detail.tags.risk}
                    {zhCN.detail.tags.riskLevels[detail.riskLevel as keyof typeof zhCN.detail.tags.riskLevels]}
                  </Badge>
                )}
                {formatScale(detail.scale) && (
                  <Badge variant="secondary">
                    {zhCN.detail.tags.scale} {formatScale(detail.scale)}
                  </Badge>
                )}
                {detail.estabDate && (
                  <Badge variant="secondary">
                    {zhCN.detail.tags.estab} {detail.estabDate}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-2xs text-[var(--fg-secondary)]">
                {latest && (
                  <span>
                    {zhCN.detail.latestNav} <span className="quote-num text-[var(--fg)]">{formatNav(latest.value)}</span>
                    <span className="ml-1">({latest.date})</span>
                  </span>
                )}
                {latest && <QuoteText value={latest.growth} neutral={stealth} />}
              </div>
            </div>
            {est?.hasEstimate && (
              <div className="flex shrink-0 flex-col items-end gap-0.5 rounded-[var(--radius-panel)] bg-[var(--surface-secondary)] px-3 py-1.5">
                <span className="text-2xs text-[var(--fg-muted)]">
                  {zhCN.detail.estimate} {est.estimateTime?.slice(-5)}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="quote-num text-[length:var(--size-font-sm)] font-semibold text-[var(--fg)]">
                    {formatNav(est.estimate)}
                  </span>
                  <QuoteText value={est.estimateGrowth} neutral={stealth} />
                </div>
              </div>
            )}
          </div>

          {/* 净值走势 */}
          <section className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                {zhCN.detail.trendTitle}
              </span>
              <div className="flex gap-0.5">
                {(Object.keys(zhCN.detail.ranges) as RangeKey[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs",
                      r === range
                        ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                        : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                    )}
                  >
                    {zhCN.detail.ranges[r]}
                  </button>
                ))}
              </div>
            </div>
            <LineChart points={chartPoints} height={200} formatValue={formatNav} />
          </section>

          <div className="grid grid-cols-2 gap-[var(--size-gap)]">
            {/* 前十重仓股 */}
            <section className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
              <div className="mb-2 text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                {zhCN.detail.holdingsTitle}
              </div>
              {detail.holdings && detail.holdings.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {detail.holdings.map((h) => (
                    <div key={h.stockCode} className="flex items-center gap-2 text-2xs">
                      <span className="quote-num w-[52px] shrink-0 text-[var(--fg-muted)]">{h.stockCode}</span>
                      <span className="w-20 shrink-0 truncate text-[var(--fg)]">{h.stockName}</span>
                      {/* 占比条 */}
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.min(100, h.percent * 5)}%` }}
                        />
                      </div>
                      <span className="quote-num w-12 shrink-0 text-right text-[var(--fg-secondary)]">
                        {h.percent.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-2xs text-[var(--fg-muted)]">{zhCN.detail.holdingsEmpty}</div>
              )}
            </section>

            {/* 基金经理 + 历史净值 */}
            <div className="flex flex-col gap-[var(--size-gap)]">
              <section className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
                <div className="mb-2 text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                  {zhCN.detail.managersTitle}
                </div>
                <div className="flex flex-col gap-1.5">
                  {(detail.managers ?? []).map((m) => (
                    <div key={m.name} className="flex items-center justify-between text-2xs">
                      <span className="font-medium text-[var(--fg)]">{m.name}</span>
                      <span className="text-[var(--fg-secondary)]">
                        {zhCN.detail.managerTenure} {m.workTime}
                        {m.profit && (
                          <span className="ml-2">
                            {zhCN.detail.managerReturn} <span className="quote-num">{m.profit}</span>
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                    {zhCN.detail.navHistoryTitle}
                    {navPage && (
                      <span className="quote-num ml-2 text-2xs font-normal text-[var(--fg-muted)]">
                        {zhCN.detail.navTotal.replace("{n}", String(navPage.total))}
                      </span>
                    )}
                  </span>
                  {/* 分页控制 */}
                  <span className="flex items-center gap-1 text-2xs text-[var(--fg-secondary)]">
                    <button
                      disabled={navIndex <= 1 || navLoading}
                      onClick={() => setNavIndex((p) => p - 1)}
                      className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--row-hover)] disabled:opacity-40"
                      aria-label={zhCN.ranking.prevPage}
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <span className="quote-num">
                      {navIndex} / {navTotalPages}
                    </span>
                    <button
                      disabled={navIndex >= navTotalPages || navLoading}
                      onClick={() => setNavIndex((p) => p + 1)}
                      className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--row-hover)] disabled:opacity-40"
                      aria-label={zhCN.ranking.nextPage}
                    >
                      <ChevronRight size={12} />
                    </button>
                  </span>
                </div>
                <table className={cn("w-full border-collapse", navLoading && "opacity-50")}>
                  <thead>
                    <tr>
                      <SortableHeader
                        label={zhCN.detail.navDate}
                        align="left"
                        active={navSort.sortState.key === "date"}
                        dir={navSort.sortState.key === "date" ? navSort.sortState.dir : null}
                        onClick={() => navSort.toggle("date")}
                      />
                      <SortableHeader
                        label={zhCN.detail.navValue}
                        active={navSort.sortState.key === "nav"}
                        dir={navSort.sortState.key === "nav" ? navSort.sortState.dir : null}
                        onClick={() => navSort.toggle("nav")}
                      />
                      <SortableHeader
                        label={zhCN.detail.navAcc}
                        active={navSort.sortState.key === "accNav"}
                        dir={navSort.sortState.key === "accNav" ? navSort.sortState.dir : null}
                        onClick={() => navSort.toggle("accNav")}
                      />
                      <SortableHeader
                        label={zhCN.detail.navGrowth}
                        active={navSort.sortState.key === "growth"}
                        dir={navSort.sortState.key === "growth" ? navSort.sortState.dir : null}
                        onClick={() => navSort.toggle("growth")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {navSort.sorted.map((r) => (
                      <tr key={r.date} className="hover:bg-[var(--row-hover)]">
                        <td className="data-grid-cell">{r.date}</td>
                        <td className="data-grid-cell text-right">{formatNav(r.nav)}</td>
                        <td className="data-grid-cell text-right">{formatNav(r.accNav)}</td>
                        <td className="data-grid-cell text-right">
                          <QuoteText value={r.growth} neutral={stealth} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
