import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import type { RankPage, SectorItem, ThemeDetail } from "@bindings/minifund/internal/model";
import { MarketService, WindowService } from "@bindings/minifund/services";
import { CopyButton, PositionStatusBadge } from "@/components/fund/fund-list-helpers";
import { FundNameCell } from "@/components/fund/FundNameCell";
import { QuoteText } from "@/components/market/QuoteText";
import { ColumnToggle } from "@/components/ui/column-toggle";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav, formatPercent } from "@/lib/format";
import { usePrefetchPager } from "@/lib/pager";
import { cn } from "@/lib/utils";
import { useColumnsStore } from "@/stores/columns";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

/** 热力网格单元 */
interface HeatNode {
  key: string;
  name: string;
  /** 用于着色与排序的数值（涨幅 % 或资金净流入 元） */
  value: number;
  /** 格子展示文案（涨幅百分比或「亿」金额） */
  display: string;
  onClick: () => void;
}

/**
 * 热力格子：背景色按收益率正负与强度渲染（红涨绿跌跟随主题 token）。
 * stealth（摸鱼模式）下统一中性灰底，不暴露涨跌。
 */
function HeatCell({
  node,
  maxAbs,
  stealth,
}: {
  node: HeatNode;
  maxAbs: number;
  stealth: boolean;
}) {
  const intensity = maxAbs > 0 ? Math.min(1, Math.abs(node.value) / maxAbs) : 0;
  const alpha = 16 + intensity * 70; // 16% ~ 86%
  const quoteVar = node.value >= 0 ? "var(--quote-up)" : "var(--quote-down)";
  const background = stealth
    ? "var(--surface-secondary)"
    : `color-mix(in srgb, ${quoteVar} ${alpha.toFixed(0)}%, var(--surface))`;
  const strong = !stealth && intensity > 0.45;
  const textColor = strong ? "#ffffff" : stealth ? "var(--fg)" : quoteVar;

  return (
    <button
      onClick={node.onClick}
      className="flex flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-2 text-center transition-transform hover:scale-[1.03]"
      style={{ background, color: textColor }}
      title={node.name}
    >
      <span className="w-full truncate text-[length:var(--size-font-xs)] font-medium">{node.name}</span>
      <span className="quote-num text-[length:var(--size-font-xs)] font-semibold">{node.display}</span>
    </button>
  );
}

/** 主题基金表格列显隐 id */
const TOPIC_TABLE_ID = "topicFunds";

/** 板块类别：全部（行业+概念）/ 行业 / 概念 */
type SectorKind = "all" | "industry" | "concept";

/** 阶段：今日(D) / 近1周(W) / 近1月(M) / 近3月(Q) / 今年来(SY)，对应 ztjj GetZTJJListNew 的 st 周期 */
type Stage = "now" | "week" | "month" | "m3" | "ytd";

/** 排序指标：按涨幅（ztjj 主题）/ 按资金流入（东财标准板块） */
type Metric = "change" | "inflow";

/** 取板块某阶段的涨跌幅（%） */
function stageValue(s: SectorItem, stage: Stage): number {
  if (stage === "week") return s.week;
  if (stage === "month") return s.month;
  if (stage === "m3") return s.month3;
  if (stage === "ytd") return s.ytd;
  return s.changePercent;
}

/** 主力净流入（元）格式化为带符号的「亿」字符串 */
function formatInflow(yuan: number): string {
  const yi = yuan / 1e8;
  const sign = yi > 0 ? "+" : "";
  return `${sign}${yi.toFixed(1)}亿`;
}

/** 主题基金表格的可排序列：列头 → 服务端排序键（对齐 ztjj GetBKRelTopicFundNew 的 sort 字段） */
const TOPIC_SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "RZDF", label: zhCN.ranking.columns.day },
  { key: "SYL_Z", label: zhCN.ranking.columns.week },
  { key: "SYL_Y", label: zhCN.ranking.columns.m1 },
  { key: "SYL_3Y", label: zhCN.ranking.columns.m3 },
  { key: "SYL_6Y", label: zhCN.ranking.columns.m6 },
  { key: "SYL_1N", label: zhCN.ranking.columns.y1 },
  { key: "SYL_JN", label: zhCN.ranking.columns.ytd },
];

const TOPIC_COLUMN_VALUES: Record<string, (item: RankPage["items"][number]) => number> = {
  RZDF: (r) => r.dayGrowth,
  SYL_Z: (r) => r.weekGrowth,
  SYL_Y: (r) => r.monthGrowth,
  SYL_3Y: (r) => r.month3,
  SYL_6Y: (r) => r.month6,
  SYL_1N: (r) => r.year1,
  SYL_JN: (r) => r.ytd,
};

/**
 * 板块行情页：行业 + 概念板块热力图（对齐天天基金 ztjj 热门主题）。
 * 板块类别（全部/行业/概念）含 CPO/PCB/光模块 等热门概念；阶段（今日/近3月/今年来）；
 * 排序（按涨跌幅/按资金流入）。点击板块匹配到基金主题则看相关基金，否则浏览器打开东财板块页。
 */
export function SectorPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const [kind, setKind] = useState<SectorKind>("concept");
  const [stage, setStage] = useState<Stage>("now");
  const [metric, setMetric] = useState<Metric>("change");
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 当前查看相关基金的主题（null 表示热力图视图） */
  const [activeSector, setActiveSector] = useState<SectorItem | null>(null);

  const loadSectors = useCallback(async (k: SectorKind, m: Metric, st: Stage) => {
    setLoading(true);
    setFailed(false);
    const list = await call("加载板块行情", () =>
      m === "inflow" ? MarketService.GetSectorMoneyFlow(k, st) : MarketService.GetSectors(k)
    );
    setLoading(false);
    if (list) {
      setSectors(list);
    } else {
      setFailed(true);
    }
  }, []);

  // 涨幅模式：一次请求返回全部周期，阶段切换仅客户端筛选，无需重新请求；
  // 资金流入模式：不同周期由接口分别返回，阶段切换需重新请求。
  const fetchStageKey = metric === "inflow" ? stage : "_";
  useEffect(() => {
    void loadSectors(kind, metric, stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, metric, fetchStageKey, loadSectors]);

  // 主题相关基金列表视图（点击热力格子进入，按 ztjj 主题代码 BKxxxxxx 拉取相关基金）
  if (activeSector) {
    return <ThemeFundsView sector={activeSector} stealth={stealth} onBack={() => setActiveSector(null)} />;
  }

  // 组装热力网格节点：涨幅模式取当前阶段涨跌幅、资金流入模式取主力净流入；
  // 两种模式均为 ztjj 主题体系（BK000xxx），点击格子统一进入「主题相关基金」列表。
  const nodes: HeatNode[] = sectors.map((s) =>
    metric === "inflow"
      ? {
          key: s.code,
          name: s.name,
          value: s.inflow,
          display: formatInflow(s.inflow),
          onClick: () => setActiveSector(s),
        }
      : {
          key: s.code,
          name: s.name,
          value: stageValue(s, stage),
          display: formatPercent(stageValue(s, stage)),
          onClick: () => setActiveSector(s),
        }
  );

  // 按当前阶段涨跌幅降序
  const sortedNodes = [...nodes].sort((a, b) => b.value - a.value);
  // 着色强度基准：涨跌幅绝对值最大者
  const maxAbs = sortedNodes.reduce((m, n) => Math.max(m, Math.abs(n.value)), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      {/* 工具栏：板块类别 + 阶段 + 排序类别 + 搜索 + 刷新 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-[var(--fg-muted)]">{zhCN.sectors.category}</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: "all", label: zhCN.sectors.catAll },
                { id: "industry", label: zhCN.sectors.catIndustry },
                { id: "concept", label: zhCN.sectors.catConcept },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setKind(opt.id)}
                className={cn(
                  "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                  opt.id === kind
                    ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-2xs text-[var(--fg-muted)]">{zhCN.sectors.sortBy}</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: "change", label: zhCN.sectors.sortChange },
                { id: "inflow", label: zhCN.sectors.sortInflow },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setMetric(opt.id);
                  // 今年来仅涨幅模式支持，切到资金流入时回退到「实时」
                  if (opt.id === "inflow" && stage === "ytd") setStage("now");
                }}
                className={cn(
                  "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                  opt.id === metric
                    ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                )}
                title={opt.id === "inflow" ? zhCN.sectors.inflowHint : undefined}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 阶段切换：涨幅模式含「今年来」；资金流入模式为 实时/近1周/近1月/近3月 */}
        <div className="flex items-center gap-2">
          <span className="text-2xs text-[var(--fg-muted)]">{zhCN.sectors.stage}</span>
          <div className="flex items-center gap-1">
            {(metric === "inflow"
              ? (["now", "week", "month", "m3"] as const)
              : (["now", "week", "month", "m3", "ytd"] as const)
            ).map((st) => (
              <button
                key={st}
                onClick={() => setStage(st)}
                className={cn(
                  "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                  st === stage
                    ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                )}
                title={
                  st === "now"
                    ? metric === "inflow"
                      ? zhCN.sectors.inflowStageHint
                      : zhCN.sectors.stageHint
                    : undefined
                }
              >
                {metric === "inflow"
                  ? zhCN.sectors.inflowStages[st as keyof typeof zhCN.sectors.inflowStages]
                  : zhCN.sectors.stages[st]}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip content={zhCN.sectors.refresh}>
            <button
              aria-label={zhCN.sectors.refresh}
              onClick={() => void loadSectors(kind, metric, stage)}
              disabled={loading}
              className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)] disabled:opacity-40"
            >
              <RefreshCw size={13} className={cn(loading && "animate-spin")} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="scroll-always relative min-h-0 flex-1 overflow-y-auto">
        {/* 加载动画 */}
        {loading && !failed && nodes.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <Spinner size={22} label={zhCN.sectors.loading} />
          </div>
        )}
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.sectors.loadFailed}
          </div>
        ) : nodes.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.sectors.empty}
          </div>
        ) : (
          <div
            className={cn(
              "grid grid-cols-4 gap-1.5 sm:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8",
              loading && "opacity-50"
            )}
          >
            {sortedNodes.map((n) => (
              <HeatCell key={n.key} node={n} maxAbs={maxAbs} stealth={stealth} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 主题近期表现单格：周期涨幅（红绿配色）+ 同类排名（日涨幅无排名，展示 --） */
function ThemeMetric({
  label,
  value,
  rank,
  count,
  stealth,
}: {
  label: string;
  value: number;
  rank: number;
  count: number;
  stealth: boolean;
}) {
  const hasRank = rank > 0 && count > 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xs text-[var(--fg-muted)]">{label}</span>
      <QuoteText
        className="quote-num text-[length:var(--size-font-sm)] font-semibold"
        value={value}
        neutral={stealth}
      />
      <span className="text-2xs text-[var(--fg-muted)]">
        {zhCN.sectors.rankLabel}：{hasRank ? `${rank}/${count}` : zhCN.sectors.rankNone}
      </span>
    </div>
  );
}

/** 主题近期表现面板：日涨幅 / 近1周 / 近1月 / 近3月 / 近1年 / 今年来（含同类排名），数据源 ztjj GetBKDetailInfoNew */
function ThemeDetailPanel({ detail, stealth }: { detail: ThemeDetail; stealth: boolean }) {
  const m = zhCN.sectors.themeMetrics;
  const items = [
    { label: m.day, value: detail.day, rank: 0, count: 0 },
    { label: m.week, value: detail.week, rank: detail.weekRank, count: detail.weekCount },
    { label: m.month, value: detail.month, rank: detail.monthRank, count: detail.monthCount },
    { label: m.m3, value: detail.month3, rank: detail.month3Rank, count: detail.month3Count },
    { label: m.y1, value: detail.year1, rank: detail.year1Rank, count: detail.year1Count },
    { label: m.ytd, value: detail.ytd, rank: detail.ytdRank, count: detail.ytdCount },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 sm:grid-cols-6">
      {items.map((it) => (
        <ThemeMetric key={it.label} {...it} stealth={stealth} />
      ))}
    </div>
  );
}

/** 主题相关基金列表视图：服务端排序 + 分页（数据源 ztjj GetBKRelTopicFundNew，按主题代码 BKxxxxxx） */
function ThemeFundsView({
  sector,
  stealth,
  onBack,
}: {
  sector: SectorItem;
  stealth: boolean;
  onBack: () => void;
}) {
  const addFund = useWatchlistStore((s) => s.addFund);
  const hidden = useColumnsStore((s) => s.hidden[TOPIC_TABLE_ID]) ?? [];
  const ensure = useColumnsStore((s) => s.ensure);
  useEffect(() => ensure(TOPIC_TABLE_ID, []), [ensure]);
  const [sortKey, setSortKey] = useState("SYL_1N");
  const [sortType, setSortType] = useState<"desc" | "asc">("desc");
  // 主题近期表现（各周期涨幅 + 同类排名），随主题切换异步加载，失败仅不展示面板
  const [detail, setDetail] = useState<ThemeDetail | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    void call("加载主题详情", () => MarketService.GetThemeDetail(sector.code)).then((d) => {
      if (alive && d) setDetail(d);
    });
    return () => {
      alive = false;
    };
  }, [sector.code]);

  // 分页加载 + 下一页后台预取；主题/排序变化自动回第 1 页
  const { page, pageIndex, loading, failed, goto } = usePrefetchPager<RankPage>(
    (pi) => call("加载主题基金", () => MarketService.GetThemeFunds(sector.code, sortKey, sortType, pi)),
    `${sector.code}|${sortKey}|${sortType}`
  );

  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortType((t) => (t === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortType("desc");
    }
  };

  const totalPages = page ? Math.max(1, Math.ceil(page.total / 50)) : 1;
  const cols = zhCN.ranking.columns;
  const visibleCols = TOPIC_SORT_COLUMNS.filter((c) => !hidden.includes(c.key));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      <div className="flex items-center gap-2">
        <Tooltip content={zhCN.sectors.backToList}>
          <button
            aria-label={zhCN.sectors.backToList}
            onClick={onBack}
            className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)]"
          >
            <ArrowLeft size={14} />
          </button>
        </Tooltip>
        <span className="text-[length:var(--size-font-sm)] font-semibold text-[var(--fg)]">
          {sector.name} · {zhCN.sectors.topicFundsTitle}
        </span>
        <QuoteText className="quote-num text-2xs" value={detail?.day ?? sector.changePercent} neutral={stealth} />
        <span className="quote-num text-2xs text-[var(--fg-muted)]">{sector.code}</span>
        {page && (
          <span className="quote-num text-2xs text-[var(--fg-muted)]">
            {zhCN.detail.navTotal.replace("{n}", String(page.total))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ColumnToggle
            tableId={TOPIC_TABLE_ID}
            columns={[
              { key: "name", label: cols.name, required: true },
              { key: "nav", label: cols.nav, required: true },
              ...TOPIC_SORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
            ]}
          />
        </div>
      </div>

      {detail && <ThemeDetailPanel detail={detail} stealth={stealth} />}

      <div className="scroll-always relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.ranking.loadFailed}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-grid-header border-b">{cols.name}</th>
                <th className="data-grid-header border-b text-right">{cols.nav}</th>
                {visibleCols.map((c) => (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    active={sortKey === c.key}
                    dir={sortKey === c.key ? sortType : null}
                    onClick={() => handleSort(c.key)}
                  />
                ))}
                <th className="data-grid-header border-b" />
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-50")}>
              {(page?.items ?? []).map((item) => (
                <tr
                  key={item.code}
                  className="group hover:bg-[var(--row-hover)]"
                  onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                >
                  <td className="data-grid-cell">
                    <FundNameCell code={item.code} name={item.name}>
                      <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
                      <div className="flex items-center gap-1">
                        <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                        <PositionStatusBadge code={item.code} />
                        <CopyButton value={item.code} name={item.name} />
                      </div>
                    </FundNameCell>
                  </td>
                  <td className="data-grid-cell text-right">{formatNav(item.nav)}</td>
                  {visibleCols.map((c) => (
                    <td key={c.key} className="data-grid-cell text-right">
                      <QuoteText value={TOPIC_COLUMN_VALUES[c.key](item)} neutral={stealth} />
                    </td>
                  ))}
                  <td className="data-grid-cell">
                    <Tooltip content={zhCN.search.add}>
                      <button
                        aria-label={zhCN.search.add}
                        onClick={() => void addFund(item.code)}
                        className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-selected)] hover:text-[var(--accent)]"
                      >
                        <Plus size={12} />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
        <button
          disabled={pageIndex <= 1 || loading}
          onClick={() => goto(pageIndex - 1)}
          className="flex items-center gap-0.5 rounded-[var(--radius-btn)] px-2 py-1 hover:bg-[var(--row-hover)] disabled:opacity-40"
        >
          <ChevronLeft size={13} />
          {zhCN.ranking.prevPage}
        </button>
        <span className="quote-num">
          {pageIndex} / {totalPages}
        </span>
        <button
          disabled={pageIndex >= totalPages || loading}
          onClick={() => goto(pageIndex + 1)}
          className="flex items-center gap-0.5 rounded-[var(--radius-btn)] px-2 py-1 hover:bg-[var(--row-hover)] disabled:opacity-40"
        >
          {zhCN.ranking.nextPage}
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
