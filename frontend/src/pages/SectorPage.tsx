import { useCallback, useEffect, useState } from "react";
import { ArrowDownWideNarrow, ArrowLeft, ArrowUpWideNarrow, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import type { RankPage, SectorItem, TopicItem } from "@bindings/minifund/internal/model";
import { MarketService, WindowService } from "@bindings/minifund/services";
import { QuoteText } from "@/components/market/QuoteText";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav } from "@/lib/format";
import { usePrefetchPager } from "@/lib/pager";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

type SectorKind = "industry" | "concept" | "topics";

/** 主题基金表格的可排序列：列头 → 服务端排序键 */
const TOPIC_SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "NAVCHGRT", label: zhCN.ranking.columns.day },
  { key: "SYL_Z", label: zhCN.ranking.columns.week },
  { key: "SYL_Y", label: zhCN.ranking.columns.m1 },
  { key: "SYL_3Y", label: zhCN.ranking.columns.m3 },
  { key: "SYL_6Y", label: zhCN.ranking.columns.m6 },
  { key: "SYL_1N", label: zhCN.ranking.columns.y1 },
  { key: "SYL_JN", label: zhCN.ranking.columns.ytd },
];

const TOPIC_COLUMN_VALUES: Record<string, (item: RankPage["items"][number]) => number> = {
  NAVCHGRT: (r) => r.dayGrowth,
  SYL_Z: (r) => r.weekGrowth,
  SYL_Y: (r) => r.monthGrowth,
  SYL_3Y: (r) => r.month3,
  SYL_6Y: (r) => r.month6,
  SYL_1N: (r) => r.year1,
  SYL_JN: (r) => r.ytd,
};

/**
 * 板块行情页：行业/概念板块卡片 + 基金主题。
 * 点击板块/主题可查看相关基金列表（服务端排序 + 分页）。
 */
export function SectorPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const [kind, setKind] = useState<SectorKind>("industry");
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 卡片排序方向（按涨跌幅） */
  const [cardSort, setCardSort] = useState<"desc" | "asc">("desc");
  /** 当前查看基金列表的主题（null 表示卡片视图） */
  const [activeTopic, setActiveTopic] = useState<TopicItem | null>(null);
  /** 板块名无对应主题时的提示 */
  const [noMatchName, setNoMatchName] = useState<string | null>(null);

  const loadSectors = useCallback(async (k: "industry" | "concept") => {
    setLoading(true);
    setFailed(false);
    const list = await call("加载板块行情", () => MarketService.GetSectors(k));
    setLoading(false);
    if (list) {
      setSectors(list);
    } else {
      setFailed(true);
    }
  }, []);

  const loadTopics = useCallback(async (): Promise<TopicItem[]> => {
    setLoading(true);
    setFailed(false);
    const list = await call("加载基金主题", () => MarketService.GetTopics());
    setLoading(false);
    if (list) {
      setTopics(list);
      return list;
    }
    setFailed(true);
    return [];
  }, []);

  useEffect(() => {
    if (kind === "topics") {
      void loadTopics();
    } else {
      void loadSectors(kind);
    }
  }, [kind, loadSectors, loadTopics]);

  /** 行业/概念板块卡片点击：按名称匹配基金主题后进入基金列表 */
  const handleSectorClick = async (sector: SectorItem) => {
    setNoMatchName(null);
    let list = topics;
    if (list.length === 0) {
      list = await loadTopics();
    }
    const match =
      list.find((t) => t.name === sector.name) ??
      list.find((t) => t.name.includes(sector.name) || sector.name.includes(t.name));
    if (match) {
      setActiveTopic(match);
    } else {
      setNoMatchName(sector.name);
      window.setTimeout(() => setNoMatchName(null), 2500);
    }
  };

  // 主题基金列表视图
  if (activeTopic) {
    return <TopicFundsView topic={activeTopic} stealth={stealth} onBack={() => setActiveTopic(null)} />;
  }

  const sortedSectors = [...sectors].sort((a, b) =>
    cardSort === "desc" ? b.changePercent - a.changePercent : a.changePercent - b.changePercent
  );
  const sortedTopics = [...topics].sort((a, b) =>
    cardSort === "desc" ? b.year1Growth - a.year1Growth : a.year1Growth - b.year1Growth
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(["industry", "concept", "topics"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                k === kind
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.sectors[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {noMatchName && (
            <span className="text-2xs text-[var(--warning)]">
              「{noMatchName}」{zhCN.sectors.noTopicMatch}
            </span>
          )}
          <Tooltip content={zhCN.sectors.sortByChange}>
            <button
              aria-label={zhCN.sectors.sortByChange}
              onClick={() => setCardSort((s) => (s === "desc" ? "asc" : "desc"))}
              className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)]"
            >
              {cardSort === "desc" ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />}
            </button>
          </Tooltip>
          <Tooltip content={zhCN.sectors.refresh}>
            <button
              aria-label={zhCN.sectors.refresh}
              onClick={() => (kind === "topics" ? void loadTopics() : void loadSectors(kind))}
              disabled={loading}
              className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)] disabled:opacity-40"
            >
              <RefreshCw size={13} className={cn(loading && "animate-spin")} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="scroll-always min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.sectors.loadFailed}
          </div>
        ) : kind === "topics" ? (
          /* 基金主题卡片 */
          <div className={cn("grid grid-cols-3 gap-[var(--size-gap)] xl:grid-cols-4", loading && "opacity-50")}>
            {sortedTopics.map((t) => (
              <Tooltip key={t.id} content={zhCN.sectors.viewFunds}>
                <button
                  onClick={() => setActiveTopic(t)}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] py-[var(--size-padding-sm)] text-left hover:border-[var(--accent)]"
                >
                  <span className="truncate text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                    {t.name}
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <QuoteText value={t.year1Growth} neutral={stealth} className="text-[length:var(--size-font-xs)] font-semibold" />
                    <span className="text-2xs text-[var(--fg-muted)]">{zhCN.sectors.year1Growth}</span>
                  </span>
                </button>
              </Tooltip>
            ))}
          </div>
        ) : (
          /* 行业/概念板块卡片 */
          <div className={cn("grid grid-cols-3 gap-[var(--size-gap)] xl:grid-cols-4", loading && "opacity-50")}>
            {sortedSectors.map((s) => (
              <Tooltip key={s.code} content={zhCN.sectors.viewFunds}>
                <button
                  onClick={() => void handleSectorClick(s)}
                  className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] py-[var(--size-padding-sm)] text-left hover:border-[var(--accent)]"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="truncate text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                      {s.name}
                    </span>
                    <QuoteText
                      value={s.changePercent}
                      neutral={stealth}
                      className="text-[length:var(--size-font-sm)] font-semibold"
                    />
                  </div>
                  <div className="flex w-full items-center justify-between text-2xs text-[var(--fg-secondary)]">
                    <span className="quote-num">
                      {zhCN.sectors.upCount} {s.upCount} / {zhCN.sectors.downCount} {s.downCount}
                    </span>
                    <span className="truncate">
                      {zhCN.sectors.leadStock} {s.leadStock}
                    </span>
                  </div>
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 主题基金列表视图：服务端排序 + 分页 */
function TopicFundsView({
  topic,
  stealth,
  onBack,
}: {
  topic: TopicItem;
  stealth: boolean;
  onBack: () => void;
}) {
  const addFund = useWatchlistStore((s) => s.addFund);
  const [sortKey, setSortKey] = useState("SYL_1N");
  const [sortType, setSortType] = useState<"desc" | "asc">("desc");

  // 分页加载 + 下一页后台预取；主题/排序变化自动回第 1 页
  const { page, pageIndex, loading, failed, goto } = usePrefetchPager<RankPage>(
    (pi) => call("加载主题基金", () => MarketService.GetTopicFunds(topic.id, sortKey, sortType, pi)),
    `${topic.id}|${sortKey}|${sortType}`
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
          {topic.name} · {zhCN.sectors.topicFundsTitle}
        </span>
        {page && (
          <span className="quote-num text-2xs text-[var(--fg-muted)]">
            {zhCN.detail.navTotal.replace("{n}", String(page.total))}
          </span>
        )}
      </div>

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
                {TOPIC_SORT_COLUMNS.map((c) => (
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
                  className="hover:bg-[var(--row-hover)]"
                  onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                >
                  <td className="data-grid-cell">
                    <div className="flex flex-col py-0.5">
                      <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
                      <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                    </div>
                  </td>
                  <td className="data-grid-cell text-right">{formatNav(item.nav)}</td>
                  {TOPIC_SORT_COLUMNS.map((c) => (
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
