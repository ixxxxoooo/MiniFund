import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { RankPage } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
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

type FundType = keyof typeof zhCN.ranking.types;
type SortKey = keyof typeof zhCN.ranking.sortKeys;

/** 可排序列定义：列头 → 服务端排序键 */
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "rzdf", label: zhCN.ranking.columns.day },
  { key: "zzf", label: zhCN.ranking.columns.week },
  { key: "1yzf", label: zhCN.ranking.columns.m1 },
  { key: "3yzf", label: zhCN.ranking.columns.m3 },
  { key: "6yzf", label: zhCN.ranking.columns.m6 },
  { key: "1nzf", label: zhCN.ranking.columns.y1 },
  { key: "jnzf", label: zhCN.ranking.columns.ytd },
];

/** 列 key → 数据字段 */
const COLUMN_VALUES: Record<SortKey, (item: RankPage["items"][number]) => number> = {
  rzdf: (r) => r.dayGrowth,
  zzf: (r) => r.weekGrowth,
  "1yzf": (r) => r.monthGrowth,
  "3yzf": (r) => r.month3,
  "6yzf": (r) => r.month6,
  "1nzf": (r) => r.year1,
  jnzf: (r) => r.ytd,
};

/**
 * 基金排行页：类型筛选 + 列头点击服务端排序（降序 ⇄ 升序）+ 分页，双击行打开详情。
 */
export function RankingPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const addFund = useWatchlistStore((s) => s.addFund);

  const [fundType, setFundType] = useState<FundType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("rzdf");
  const [sortType, setSortType] = useState<"desc" | "asc">("desc");

  // 分页加载 + 下一页后台预取（翻页零等待）；筛选/排序变化自动回第 1 页
  const { page, pageIndex, loading, failed, goto } = usePrefetchPager<RankPage>(
    (pi) => call("加载基金排行", () => FundService.GetFundRanking(fundType, sortKey, sortType, pi)),
    `${fundType}|${sortKey}|${sortType}`
  );

  /** 列头点击：同列切换方向，异列重置为降序 */
  const handleSort = (key: SortKey) => {
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
      {/* 类型筛选 */}
      <div className="flex items-center gap-1">
        {(Object.keys(zhCN.ranking.types) as FundType[]).map((t) => (
          <button
            key={t}
            onClick={() => setFundType(t)}
            className={cn(
              "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
              t === fundType
                ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
            )}
          >
            {zhCN.ranking.types[t]}
          </button>
        ))}
      </div>

      {/* 排行表格 */}
      <div className="scroll-always relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.ranking.loadFailed}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-grid-header border-b text-right">{cols.rank}</th>
                <th className="data-grid-header border-b">{cols.name}</th>
                <th className="data-grid-header border-b text-right">{cols.nav}</th>
                {SORT_COLUMNS.map((c) => (
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
              {(page?.items ?? []).map((item, i) => (
                <tr
                  key={item.code}
                  className="hover:bg-[var(--row-hover)]"
                  onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                >
                  <td className="data-grid-cell text-right text-[var(--fg-muted)]">
                    {(pageIndex - 1) * 50 + i + 1}
                  </td>
                  <td className="data-grid-cell">
                    <div className="flex flex-col py-0.5">
                      <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
                      <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                    </div>
                  </td>
                  <td className="data-grid-cell text-right">{formatNav(item.nav)}</td>
                  {SORT_COLUMNS.map((c) => (
                    <td key={c.key} className="data-grid-cell text-right">
                      <QuoteText value={COLUMN_VALUES[c.key](item)} neutral={stealth} />
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

      {/* 分页 */}
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
