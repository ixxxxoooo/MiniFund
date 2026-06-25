import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Window } from "@wailsio/runtime";
import type { BondHolding, FundDetail, Holding, ManagerInfo, NavPage, PositionTxn } from "@bindings/minifund/internal/model";
import { FundService, PortfolioService } from "@bindings/minifund/services";
import { ChartMarker, LineChart } from "@/components/charts/LineChart";
import { ManagerDialog } from "@/components/fund/ManagerDialog";
import { ThemeChips, useFundThemes } from "@/components/fund/fund-list-helpers";
import { TitleBar } from "@/components/layout/TitleBar";
import { QuoteText } from "@/components/market/QuoteText";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { onNavConfirmed, onWatchlistChanged } from "@/lib/wails/events";
import { OpenExternalURL } from "@/lib/wails/runtime";
import { formatNav } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { useLocalSort } from "@/lib/sort";
import { eastmoneyStockURL } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";

/** 历史净值每页条数（滚动到底自动加载下一页） */
const NAV_PAGE_SIZE = 20;

type NavItem = NonNullable<NavPage["items"]>[number];

/** 将规模原始字符串（元）格式化为易读金额（亿/万两档）。
 *  与 lib/format.ts 的通用 formatScale 口径一致，保证详情窗口与排行/分析页对同一基金规模读数相同。
 *  仅在无有效数据时返回空串（用于条件渲染隐藏该标签）。 */
function formatScale(raw: string): string {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

/** 将单日限额原始字符串（元）格式化为易读金额（万/亿元） */
function formatDayLimit(raw: string): string {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return raw;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿元";
  if (v >= 1e4) return (v / 1e4).toFixed(0) + "万元";
  return v.toFixed(0) + "元";
}

interface DetailWindowProps {
  /** 基金代码，来自 hash 路由 /#/detail/{code} */
  code: string;
}

/** 详情页展示的阶段涨幅周期（顺序即展示顺序，键与后端 PeriodReturn.period 一致） */
const PERIOD_ORDER = ["Y", "3Y", "6Y", "1N", "3N", "LN"] as const;

/**
 * 阶段涨幅栅格：近1月/近3月/近6月/近1年/近3年/成立来，涨跌红绿、附同类平均。
 */
function PeriodReturns({
  returns,
  stealth,
}: {
  returns: NonNullable<FundDetail["periodReturns"]>;
  stealth: boolean;
}) {
  const map = new Map(returns.map((r) => [r.period, r]));
  const cells = PERIOD_ORDER.map((p) => ({ key: p, label: zhCN.detail.periodLabels[p], data: map.get(p) }));
  // 无任何周期数据则不渲染该区块
  if (!cells.some((c) => c.data)) return null;

  return (
    <section className="shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
          {zhCN.detail.periodTitle}
        </span>
        <div className="grid flex-1 grid-cols-6 gap-2">
          {cells.map((c) => (
            <div key={c.key} className="flex flex-col items-center gap-0.5">
              <span className="text-2xs text-[var(--fg-muted)]">{c.label}</span>
              {c.data ? (
                <>
                  <QuoteText
                    value={c.data.value}
                    neutral={stealth}
                    className="text-[length:var(--size-font-sm)] font-semibold"
                  />
                  {c.data.avg !== 0 && (
                    <span className="text-[10px] text-[var(--fg-muted)]">
                      {zhCN.detail.periodAvg} {c.data.avg.toFixed(2)}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[length:var(--size-font-sm)] text-[var(--fg-muted)]">—</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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
  // 基金所属主题标签（与排行/搜索同一懒加载来源，带后端缓存）
  const themesMap = useFundThemes([code]);

  const [detail, setDetail] = useState<FundDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<RangeKey>("y1");
  const [activeManager, setActiveManager] = useState<ManagerInfo | null>(null);
  // 持仓 Tab：股票 / 债券；详情加载后默认有股票选股票、否则选债券
  const [holdTab, setHoldTab] = useState<"stock" | "bond">("stock");

  // Esc / ⌘W 关闭详情窗口（经理档案弹窗打开时 Esc 先关弹窗，由 Radix 处理）
  useHotkeys({
    escape: () => {
      if (!activeManager) void Window.Close();
    },
    "meta+w": () => void Window.Close(),
  });

  // 该基金交易流水（用于在走势图上标注买入/卖出点）
  const [txns, setTxns] = useState<PositionTxn[]>([]);

  useEffect(() => {
    void loadSettings();
    void call("加载基金详情", () => FundService.GetFundDetail(code)).then((d) => {
      if (d) {
        setDetail(d);
        // 默认 Tab：有股票持仓选「股票」，否则选「债券」（纯债基金）
        setHoldTab((d.holdings?.length ?? 0) > 0 ? "stock" : "bond");
      } else {
        setFailed(true);
      }
    });
  }, [code, loadSettings]);

  // 行情事件订阅独立于基金 code：整个窗口生命周期订阅一次，卸载时统一取消。
  useEffect(() => {
    return initMarket();
  }, [initMarket]);

  // 加载交易流水；任一窗口持仓变更后重新加载，保证走势图标记同步
  useEffect(() => {
    const reloadTxns = () =>
      void call("加载交易流水", () => PortfolioService.ListTransactions(code)).then((list) => {
        if (list) setTxns(list);
      });
    reloadTxns();
    return onWatchlistChanged(reloadTxns);
  }, [code]);

  // 本基金净值确认后刷新详情快照（走势图 / 阶段涨幅），避免一次性快照过期
  useEffect(() => {
    return onNavConfirmed((data) => {
      if (data.code !== code) return;
      void call("刷新基金详情", () => FundService.GetFundDetail(code)).then((d) => {
        if (d) setDetail(d);
      });
    });
  }, [code]);

  // 历史净值无限滚动：累积所有已加载条目，滚动到底自动加载下一页
  const [navItems, setNavItems] = useState<NavItem[]>([]);
  const [navTotal, setNavTotal] = useState(0);
  const [navLoading, setNavLoading] = useState(false);
  // navLoaded：是否已完成至少一次加载（区分「未加载」与「加载后为空」，避免 total=0 时反复触发空加载）
  const [navLoaded, setNavLoaded] = useState(false);
  const navPageRef = useRef(0); // 已加载到的页码
  const navLoadingRef = useRef(false);
  const codeRef = useRef(code); // 跟踪当前基金 code，用于 loadMoreNav 请求返回后防竞态

  // 切换基金时重置并加载第一页
  useEffect(() => {
    let cancelled = false;
    codeRef.current = code;
    setNavItems([]);
    setNavTotal(0);
    setNavLoaded(false);
    navPageRef.current = 0;
    navLoadingRef.current = true;
    setNavLoading(true);
    void call("加载历史净值", () => FundService.GetNavHistory(code, 1, NAV_PAGE_SIZE)).then((page) => {
      if (cancelled || codeRef.current !== code) return;
      if (page) {
        setNavItems(page.items ?? []);
        setNavTotal(page.total);
        navPageRef.current = 1;
      }
      setNavLoaded(true);
      navLoadingRef.current = false;
      setNavLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const navHasMore = !navLoaded || (navTotal > 0 && navItems.length < navTotal);

  const loadMoreNav = useCallback(async () => {
    if (navLoadingRef.current) return;
    if (navTotal > 0 && navItems.length >= navTotal) return;
    navLoadingRef.current = true;
    setNavLoading(true);
    const currentCode = code; // 捕获发起时的 code，请求返回后比对 codeRef 防止切换基金时混入旧数据
    const next = navPageRef.current + 1;
    const page = await call("加载历史净值", () => FundService.GetNavHistory(currentCode, next, NAV_PAGE_SIZE));
    // 切换基金期间返回的旧请求结果丢弃，避免追加到新基金列表
    if (page && codeRef.current === currentCode) {
      setNavItems((prev) => [...prev, ...(page.items ?? [])]);
      setNavTotal(page.total);
      navPageRef.current = next;
    }
    navLoadingRef.current = false;
    setNavLoading(false);
  }, [code, navTotal, navItems.length]);

  const onNavScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void loadMoreNav();
  };

  const est = estimates[code];

  // 按时间档截取净值走势
  const chartPoints = useMemo(() => {
    const trend = detail?.netWorthTrend ?? [];
    const days = RANGE_DAYS[range];
    const slice = days === Infinity ? trend : trend.slice(-days);
    return slice.map((p) => ({ date: p.date, value: p.value }));
  }, [detail, range]);

  // 将交易流水映射为走势图标记：按日期对齐到当日或之前最近的净值点，
  // 同日同方向（买/卖）合并为一个标记，提示里逐笔列出。
  const chartMarkers = useMemo<ChartMarker[]>(() => {
    if (chartPoints.length < 2 || txns.length === 0) return [];
    const firstDate = chartPoints[0].date;
    // index → { buy?: ChartMarker, sell?: ChartMarker }
    const byIndex = new Map<string, ChartMarker>();
    for (const tx of txns) {
      if (tx.date < firstDate) continue; // 落在可视区间之前，跳过
      // 找到日期 ≤ 交易日的最近净值点（处理非交易日/周末）
      let idx = -1;
      for (let i = 0; i < chartPoints.length; i++) {
        if (chartPoints[i].date <= tx.date) idx = i;
        else break;
      }
      if (idx < 0) continue;
      const kind: "buy" | "sell" = tx.kind === "sell" ? "sell" : "buy";
      const key = `${idx}-${kind}`;
      const label = kind === "sell" ? zhCN.position.sell : zhCN.position.buy;
      const line = `${tx.date} ${label} ${tx.shares.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}份 @${formatNav(tx.price)}`;
      const existing = byIndex.get(key);
      if (existing) existing.tip.push(line);
      else byIndex.set(key, { index: idx, kind, tip: [line] });
    }
    return Array.from(byIndex.values());
  }, [chartPoints, txns]);

  // 最新（已确认）净值：优先取实时行情 store 的已公布数据（navDate/prevNav/dayGrowth），
  // 避免详情快照在窗口打开后不再刷新、导致新净值确认后涨跌幅仍是旧值（与外面列表不一致）；
  // store 无该基金（如非自选基金）时回退到详情快照。
  const latestSnap = detail?.netWorthTrend?.[detail.netWorthTrend.length - 1];
  const liveDay = est?.hasDayGrowth ? est : null;
  const latestDate = liveDay ? liveDay.navDate : latestSnap?.date;
  const latestNav = liveDay ? liveDay.prevNav : latestSnap?.value;
  const latestGrowth = liveDay ? liveDay.dayGrowth : latestSnap?.growth;

  // 历史净值本地排序（作用于已累积的全部条目）
  const navSort = useLocalSort(navItems, {
    date: (r) => r.date,
    nav: (r) => r.nav,
    accNav: (r) => r.accNav,
    growth: (r) => r.growth,
  });

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
        <main className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] overflow-hidden p-[var(--size-padding)]">
          {/* 头部信息 */}
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--size-font-base)] font-semibold text-[var(--fg)]">
                  {detail.name}
                </span>
                {detail.rate && <Badge variant="secondary">{zhCN.detail.rate} {detail.rate}%</Badge>}
                <Tooltip content={zhCN.detail.openHomepage}>
                  <button
                    aria-label={zhCN.detail.openHomepage}
                    onClick={() => void OpenExternalURL(`https://fund.eastmoney.com/${detail.code}.html`)}
                    className="flex items-center gap-1 rounded-[var(--radius-btn)] px-2 py-0.5 text-2xs text-[var(--accent)] hover:bg-[var(--row-hover)]"
                  >
                    <ExternalLink size={12} />
                    {zhCN.detail.openHomepage}
                  </button>
                </Tooltip>
              </div>
              {/* 标签行：类型 / 公司 / 跟踪指数 / 风险等级 / 规模 / 成立日期 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {detail.type && <Badge variant="secondary">{detail.type}</Badge>}
                {detail.company && <Badge variant="secondary">{detail.company}</Badge>}
                {/* 所属主题标签（彩色药丸，最多展示 6 个，hover 显示全部） */}
                <ThemeChips themes={themesMap[detail.code]} max={6} />
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
                {detail.maxDrawdown < 0 && (
                  <Badge variant="danger">
                    {zhCN.detail.maxDrawdown} {detail.maxDrawdown.toFixed(2)}%
                  </Badge>
                )}
                {/* 交易状态：申购/赎回状态 + 单日限额（QDII 常见限额，无数据时不展示） */}
                {detail.subStatus && (
                  <Badge variant="secondary">
                    {zhCN.detail.tags.sub} {detail.subStatus}
                  </Badge>
                )}
                {detail.redeemStatus && (
                  <Badge variant="secondary">
                    {zhCN.detail.tags.redeem} {detail.redeemStatus}
                  </Badge>
                )}
                {detail.dayLimit && (
                  <Badge variant="warning">
                    {zhCN.detail.tags.dayLimit} {formatDayLimit(detail.dayLimit)}
                  </Badge>
                )}
              </div>
            </div>
            {/* 右侧：最新净值与盘中估算并排展示 */}
            <div className="flex shrink-0 items-stretch gap-3">
              {latestDate != null && latestNav != null && latestGrowth != null && (
                // 最新净值：左侧上日期下净值，右侧放大百分比（去掉「最新净值」标签文字）
                <div className="flex items-center gap-3 rounded-[var(--radius-panel)] bg-[var(--surface-secondary)] px-3 py-1.5">
                  <div className="flex flex-col items-start leading-tight">
                    <span className="quote-num text-2xs text-[var(--fg-muted)]">{latestDate}</span>
                    <span className="quote-num text-[length:var(--size-font-base)] font-bold text-[var(--fg)]">
                      {formatNav(latestNav)}
                    </span>
                  </div>
                  <QuoteText
                    value={latestGrowth}
                    neutral={stealth}
                    className="text-[length:var(--size-font-lg)] font-bold leading-none"
                  />
                </div>
              )}
              {est?.hasEstimate && (
                <div className="flex flex-col items-end justify-center gap-0.5 rounded-[var(--radius-panel)] border border-dashed border-[var(--border-color)] bg-[var(--surface-secondary)] px-3 py-1">
                  <span className="text-2xs text-[var(--fg-muted)]">
                    {zhCN.detail.estimate} {est.estimateTime?.slice(-5)}
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="quote-num text-[length:var(--size-font-sm)] font-bold leading-none text-[var(--fg)]">
                      {formatNav(est.estimate)}
                    </span>
                    <QuoteText
                      value={est.estimateGrowth}
                      neutral={stealth}
                      className="text-[length:var(--size-font-base)] font-bold leading-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 阶段涨幅：近1月/近3月/近6月/近1年/近3年/成立来（含同类平均，红绿配色） */}
          <PeriodReturns returns={detail.periodReturns ?? []} stealth={stealth} />

          {/* 净值走势 */}
          <section className="shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
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
            <LineChart points={chartPoints} height={200} formatValue={formatNav} markers={chartMarkers} />
            {chartMarkers.length > 0 && (
              <div className="mt-1 flex items-center justify-end gap-3 text-2xs text-[var(--fg-muted)]">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--marker-buy)" }} />
                  {zhCN.detail.markerBuy}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--marker-sell)" }} />
                  {zhCN.detail.markerSell}
                </span>
              </div>
            )}
          </section>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[var(--size-gap)]">
            {/* 持仓：股票 / 债券分两块，Tab 切换；某类型无数据则不显示对应 Tab */}
            <HoldingsSection
              holdings={detail.holdings ?? []}
              bondHoldings={detail.bondHoldings ?? []}
              tab={holdTab}
              onTab={setHoldTab}
              stealth={stealth}
            />

            {/* 基金经理 + 历史净值 */}
            <div className="flex min-h-0 flex-col gap-[var(--size-gap)]">
              <section className="shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
                <div className="mb-2 text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                  {zhCN.detail.managersTitle}
                </div>
                <div className="flex flex-col gap-1">
                  {(detail.managers ?? []).map((m) => (
                    <Tooltip key={m.name} content={zhCN.manager.viewProfile}>
                      <button
                        onClick={() => setActiveManager(m)}
                        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left text-2xs hover:bg-[var(--row-hover)]"
                      >
                        <span className="whitespace-nowrap font-medium text-[var(--accent)]">{m.name}</span>
                        <span className="truncate text-right text-[var(--fg-secondary)]">
                          {zhCN.detail.managerTenure} {m.workTime}
                          {m.profit && (
                            <span className="ml-2 whitespace-nowrap">
                              {zhCN.detail.managerReturn} <span className="quote-num">{m.profit}</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
                <div className="mb-1 flex shrink-0 items-center justify-between">
                  <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                    {zhCN.detail.navHistoryTitle}
                    {navTotal > 0 && (
                      <span className="quote-num ml-2 text-2xs font-normal text-[var(--fg-muted)]">
                        {zhCN.detail.navTotal.replace("{n}", String(navTotal))}
                      </span>
                    )}
                  </span>
                </div>
                {/* 滚动容器：滚动到底自动加载下一页 */}
                <div className="scroll-always min-h-0 flex-1 overflow-y-auto" onScroll={onNavScroll}>
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-[1] bg-[var(--surface)]">
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
                          <td className="data-grid-cell text-right"><span className="quote-num">{formatNav(r.nav)}</span></td>
                          <td className="data-grid-cell text-right"><span className="quote-num">{formatNav(r.accNav)}</span></td>
                          <td className="data-grid-cell text-right">
                            <QuoteText value={r.growth} neutral={stealth} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="py-2 text-center text-2xs text-[var(--fg-muted)]">
                    {navLoading ? zhCN.detail.loadingMore : !navHasMore && navItems.length > 0 ? zhCN.detail.noMore : ""}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      )}
      <ManagerDialog manager={activeManager} onClose={() => setActiveManager(null)} />
    </div>
  );
}

/**
 * 持仓区块：股票（前十重仓股）/ 债券（重仓债券）分两块，Tab 切换。
 * 某类型无数据则不显示其 Tab；两类皆空时展示「暂无持仓数据」。
 * 债券条目可能较多，固定行高 + 滚动展示，避免行高被压扁导致文字重叠。
 */
function HoldingsSection({
  holdings,
  bondHoldings,
  tab,
  onTab,
  stealth,
}: {
  holdings: Holding[];
  bondHoldings: BondHolding[];
  tab: "stock" | "bond";
  onTab: (t: "stock" | "bond") => void;
  stealth: boolean;
}) {
  const hasStocks = holdings.length > 0;
  const hasBonds = bondHoldings.length > 0;
  // 有效 Tab：选中类无数据时回退到另一类
  let eff: "stock" | "bond" = tab;
  if (eff === "stock" && !hasStocks) eff = "bond";
  if (eff === "bond" && !hasBonds) eff = "stock";

  const tabBtn = (key: "stock" | "bond", label: string) => (
    <button
      onClick={() => onTab(key)}
      className={cn(
        "rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--size-font-sm)] font-medium",
        eff === key
          ? "bg-[var(--row-selected)] text-[var(--accent)]"
          : "text-[var(--fg-muted)] hover:bg-[var(--row-hover)]"
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="flex min-h-0 flex-col rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding-sm)]">
      {/* 头部：Tab 切换 + 列标签 */}
      <div className="mb-1 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-1">
          {hasStocks && tabBtn("stock", zhCN.detail.holdingsTitle)}
          {hasBonds && tabBtn("bond", zhCN.detail.bondHoldingsTitle)}
          {!hasStocks && !hasBonds && (
            <span className="px-1 text-[length:var(--size-font-sm)] font-medium text-[var(--fg)]">
              {zhCN.detail.holdingsTitle}
            </span>
          )}
        </div>
        {hasStocks && eff === "stock" && (
          <span className="flex items-center gap-3 text-2xs text-[var(--fg-muted)]">
            <span className="w-16 text-right">{zhCN.detail.holdingPercent}</span>
            <span className="w-20 text-right">{zhCN.detail.holdingChange}</span>
          </span>
        )}
        {hasBonds && eff === "bond" && (
          <span className="w-16 text-right text-2xs text-[var(--fg-muted)]">{zhCN.detail.holdingPercent}</span>
        )}
      </div>

      {/* 内容 */}
      {!hasStocks && !hasBonds ? (
        <div className="py-4 text-center text-2xs text-[var(--fg-muted)]">{zhCN.detail.holdingsEmpty}</div>
      ) : eff === "stock" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {holdings.map((h) => {
            const url = eastmoneyStockURL(h.stockCode);
            return (
              <div
                key={h.stockCode}
                className="flex min-h-0 flex-1 items-center gap-3 border-b border-[var(--border-subtle)] text-[length:var(--size-font-sm)] last:border-b-0"
              >
                <span className="quote-num w-16 shrink-0 text-[var(--fg-muted)]">{h.stockCode}</span>
                {url ? (
                  <button
                    onClick={() => void OpenExternalURL(url)}
                    className="w-24 shrink-0 truncate text-left font-medium text-[var(--accent)] hover:underline"
                    title={h.stockName}
                  >
                    {h.stockName}
                  </button>
                ) : (
                  <span className="w-24 shrink-0 truncate font-medium text-[var(--fg)]" title={h.stockName}>
                    {h.stockName}
                  </span>
                )}
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${Math.min(100, h.percent * 5)}%` }}
                  />
                </div>
                <span className="quote-num w-16 shrink-0 text-right font-medium text-[var(--fg-secondary)]">
                  {h.percent.toFixed(2)}%
                </span>
                <QuoteText value={h.changePercent} neutral={stealth} className="w-20 shrink-0 text-right font-semibold" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="scroll-always min-h-0 flex-1 overflow-y-auto">
          {bondHoldings.map((b, i) => (
            <div
              key={b.bondCode + b.bondName + i}
              className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-1.5 text-[length:var(--size-font-sm)] last:border-b-0"
            >
              <span className="quote-num w-16 shrink-0 text-[var(--fg-muted)]">{b.bondCode}</span>
              <span className="w-28 shrink-0 truncate font-medium text-[var(--fg)]" title={b.bondName}>
                {b.bondName}
              </span>
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${Math.min(100, b.percent * 2)}%` }}
                />
              </div>
              <span className="quote-num w-16 shrink-0 text-right font-medium text-[var(--fg-secondary)]">
                {b.percent.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
