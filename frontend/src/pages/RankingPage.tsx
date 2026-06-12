import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { RankPage } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

type FundType = keyof typeof zhCN.ranking.types;
type SortKey = keyof typeof zhCN.ranking.sortKeys;

/**
 * 基金排行页：类型筛选 + 排序 + 分页，双击行打开详情。
 */
export function RankingPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const addFund = useWatchlistStore((s) => s.addFund);

  const [fundType, setFundType] = useState<FundType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("rzdf");
  const [pageIndex, setPageIndex] = useState(1);
  const [page, setPage] = useState<RankPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadPage = useCallback(async (ft: FundType, sk: SortKey, pi: number) => {
    setLoading(true);
    setFailed(false);
    const result = await call("加载基金排行", () => FundService.GetFundRanking(ft, sk, pi));
    setLoading(false);
    if (result) {
      setPage(result);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadPage(fundType, sortKey, pageIndex);
  }, [fundType, sortKey, pageIndex, loadPage]);

  const totalPages = page ? Math.max(1, Math.ceil(page.total / 50)) : 1;
  const cols = zhCN.ranking.columns;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(Object.keys(zhCN.ranking.types) as FundType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setFundType(t);
                setPageIndex(1);
              }}
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
        <select
          value={sortKey}
          onChange={(e) => {
            setSortKey(e.target.value as SortKey);
            setPageIndex(1);
          }}
          className="h-[var(--size-input-sm)] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-xs)] text-[var(--fg)] outline-none"
        >
          {(Object.keys(zhCN.ranking.sortKeys) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {zhCN.ranking.sortKeys[k]}
            </option>
          ))}
        </select>
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
                <th className="data-grid-header border-b text-right">{cols.day}</th>
                <th className="data-grid-header border-b text-right">{cols.week}</th>
                <th className="data-grid-header border-b text-right">{cols.m1}</th>
                <th className="data-grid-header border-b text-right">{cols.m3}</th>
                <th className="data-grid-header border-b text-right">{cols.m6}</th>
                <th className="data-grid-header border-b text-right">{cols.y1}</th>
                <th className="data-grid-header border-b text-right">{cols.ytd}</th>
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
                  <td className="data-grid-cell text-right"><QuoteText value={item.dayGrowth} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.weekGrowth} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.monthGrowth} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.month3} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.month6} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.year1} neutral={stealth} /></td>
                  <td className="data-grid-cell text-right"><QuoteText value={item.ytd} neutral={stealth} /></td>
                  <td className="data-grid-cell">
                    <button
                      aria-label={zhCN.search.add}
                      title={zhCN.search.add}
                      onClick={() => void addFund(item.code)}
                      className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-selected)] hover:text-[var(--accent)]"
                    >
                      <Plus size={12} />
                    </button>
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
          onClick={() => setPageIndex((p) => p - 1)}
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
          onClick={() => setPageIndex((p) => p + 1)}
          className="flex items-center gap-0.5 rounded-[var(--radius-btn)] px-2 py-1 hover:bg-[var(--row-hover)] disabled:opacity-40"
        >
          {zhCN.ranking.nextPage}
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
