import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { FundIndexItem, FundIndexPage, FundPerf, FundTheme } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { AddButton, ThemeChips, useFundPerformance, useFundThemes } from "@/components/fund/fund-list-helpers";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import { Spinner } from "@/components/ui/spinner";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { usePrefetchPager } from "@/lib/pager";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

/** 每页条数：与后端 rankSearchPageSize 保持一致 */
const SEARCH_PAGE_SIZE = 30;

/**
 * 搜索页：基金 + 基金公司统一模糊搜索（本地索引：代码 / 名称 / 拼音首字母 / 公司前缀）。
 * 默认搜索框垂直居中；输入关键字后搜索框上移至顶部，下方展示结果表格（含阶段收益异步补全）。
 */
export function SearchPage() {
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const active = keyword.trim().length > 0;

  // 输入防抖：停顿 250ms 自动提交搜索
  useEffect(() => {
    const id = window.setTimeout(() => setKeyword(input.trim()), 250);
    return () => window.clearTimeout(id);
  }, [input]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col p-[var(--size-padding)]",
        active ? "gap-[var(--size-gap)]" : "items-center justify-center gap-3"
      )}
    >
      {/* 搜索输入框：默认居中放大，搜索时上移并铺满 */}
      <div
        className={cn(
          "flex h-[var(--size-input)] shrink-0 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3 transition-all duration-300 focus-within:border-[var(--accent)]",
          active ? "w-full" : "w-full max-w-xl"
        )}
      >
        <Search size={active ? 15 : 17} className="shrink-0 text-[var(--fg-muted)]" />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={zhCN.searchPage.placeholder}
          className="h-full w-full bg-transparent text-[length:var(--size-font-sm)] text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
        />
        {input && (
          <button
            aria-label={zhCN.common.cancel}
            onClick={() => setInput("")}
            className="shrink-0 rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {active ? (
        <SearchResults keyword={keyword} />
      ) : (
        <span className="text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">{zhCN.searchPage.prompt}</span>
      )}
    </div>
  );
}

/** 阶段收益列定义（取值 + 列宽） */
const PERF_COLS: { key: string; label: string; value: (p: FundPerf) => number; ready: (p: FundPerf) => boolean }[] = [
  { key: "day", label: zhCN.searchPage.perf.day, value: (p) => p.dayGrowth, ready: (p) => p.hasDay },
  { key: "week", label: zhCN.searchPage.perf.week, value: (p) => p.weekGrowth, ready: (p) => p.hasPeriod },
  { key: "month", label: zhCN.searchPage.perf.month, value: (p) => p.monthGrowth, ready: (p) => p.hasPeriod },
  { key: "month3", label: zhCN.searchPage.perf.month3, value: (p) => p.month3, ready: (p) => p.hasPeriod },
  { key: "year1", label: zhCN.searchPage.perf.year1, value: (p) => p.year1, ready: (p) => p.hasPeriod },
];

/** 搜索结果列表：本地索引分页（名称/代码/拼音/公司前缀匹配）+ 阶段收益异步补全。 */
function SearchResults({ keyword }: { keyword: string }) {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const { page, pageIndex, loading, failed, goto } = usePrefetchPager<FundIndexPage>(
    (pi) => call("搜索基金", () => FundService.SearchFundsPage(keyword, pi)),
    `search|${keyword}`
  );
  const total = page?.total ?? 0;
  const totalPages = page ? Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)) : 1;
  const items = page?.items ?? [];
  const empty = !loading && !failed && items.length === 0;
  const codes = useMemo(() => items.map((it) => it.code), [items]);
  const themesMap = useFundThemes(codes);
  const perfMap = useFundPerformance(codes);
  const cols = zhCN.ranking.columns;

  return (
    <>
      {/* 结果状态条 */}
      <div className="flex items-center text-2xs text-[var(--fg-muted)]">
        <span>
          {zhCN.searchPage.result}
          {total > 0 && (
            <span className="ml-1 text-[var(--fg-secondary)]">{zhCN.ranking.searchTotal.replace("{n}", String(total))}</span>
          )}
        </span>
      </div>

      <div className="scroll-always relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {loading && !failed && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--surface)]/60 backdrop-blur-[1px]">
            <Spinner size={22} label={zhCN.ranking.loading} />
          </div>
        )}
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.ranking.loadFailed}
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.ranking.searchEmpty}
          </div>
        ) : (
          <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%", minWidth: 860 }}>
            <colgroup>
              <col style={{ width: 46 }} />
              <col />
              <col style={{ width: 104 }} />
              {PERF_COLS.map((c) => (
                <col key={c.key} style={{ width: 76 }} />
              ))}
              <col style={{ width: 150 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-grid-header border-b text-right">{cols.rank}</th>
                <th className="data-grid-header border-b">{cols.name}</th>
                <th className="data-grid-header border-b">{cols.type}</th>
                {PERF_COLS.map((c) => (
                  <th key={c.key} className="data-grid-header border-b text-right">
                    {c.label}
                  </th>
                ))}
                <th className="data-grid-header border-b text-center">{cols.actions}</th>
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-50")}>
              {items.map((item, i) => (
                <SearchRow
                  key={item.code}
                  item={item}
                  rank={(pageIndex - 1) * SEARCH_PAGE_SIZE + i + 1}
                  themes={themesMap[item.code]}
                  perf={perfMap[item.code]}
                  stealth={stealth}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pager pageIndex={pageIndex} totalPages={totalPages} loading={loading} onGoto={goto} />
    </>
  );
}

/** 搜索结果行：基金名称 + 代码 + 主题标签、类型、阶段收益、加自选 / 详情 */
function SearchRow({
  item,
  rank,
  themes,
  perf,
  stealth,
}: {
  item: FundIndexItem;
  rank: number;
  themes?: FundTheme[];
  perf?: FundPerf;
  stealth: boolean;
}) {
  const addFund = useWatchlistStore((s) => s.addFund);
  return (
    <tr
      className="hover:bg-[var(--row-hover)]"
      onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
    >
      <td className="data-grid-cell text-right text-[var(--fg-muted)]">{rank}</td>
      <td className="data-grid-cell">
        <div className="flex flex-col gap-0.5 py-0.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
            <ThemeChips themes={themes} className="ml-auto" />
          </div>
          <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
        </div>
      </td>
      <td className="data-grid-cell">
        <Badge variant="secondary">{item.type}</Badge>
      </td>
      {PERF_COLS.map((c) => (
        <td key={c.key} className="data-grid-cell text-right">
          {perf && c.ready(perf) ? (
            <QuoteText value={c.value(perf)} neutral={stealth} />
          ) : (
            <span className="quote-num text-[var(--fg-muted)]">—</span>
          )}
        </td>
      ))}
      <td className="data-grid-cell">
        <div className="flex items-center justify-center gap-1">
          <AddButton code={item.code} onAdd={() => void addFund(item.code)} />
          <button
            onClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
          >
            {zhCN.search.detail}
          </button>
        </div>
      </td>
    </tr>
  );
}
