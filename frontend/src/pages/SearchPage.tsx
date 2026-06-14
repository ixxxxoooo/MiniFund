import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { FundIndexItem, FundPerf, FundTheme } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { AddButton, CopyButton, ThemeChips, useFundPerformance, useFundThemes } from "@/components/fund/fund-list-helpers";
import { Badge } from "@/components/ui/badge";
import { ColumnToggle } from "@/components/ui/column-toggle";
import { Pager } from "@/components/ui/pager";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Spinner } from "@/components/ui/spinner";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useColumnsStore } from "@/stores/columns";
import { useSearchHistoryStore } from "@/stores/searchHistory";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

/** 每页条数：与后端 rankSearchPageSize 保持一致 */
const SEARCH_PAGE_SIZE = 30;

const cols = zhCN.ranking.columns;

/** 基金类型筛选键（与基金排行一致） */
type FundType = keyof typeof zhCN.ranking.types;

/** 固定列宽（px）：序号 / 基金名称（行内含彩色主题标签）/ 操作列 */
const RANK_W = 46;
const NAME_W = 264;
const ACTION_W = 148;

/** 单元格上下文：当前行基金、异步补全的阶段收益、摸鱼模式 */
type CellCtx = { item: FundIndexItem; perf?: FundPerf; stealth: boolean };

interface SearchCol {
  key: string;
  label: string;
  /** 固定列宽（px），配合 table-layout:fixed 保证列宽稳定 */
  width: number;
  /** 文本对齐（默认右对齐，数值列用） */
  align?: "left" | "right";
  render: (ctx: CellCtx) => ReactNode;
}

/** 阶段收益单元格：未补全时占位「—」 */
function perfCell(get: (p: FundPerf) => number, ready: (p: FundPerf) => boolean) {
  return ({ perf, stealth }: CellCtx) =>
    perf && ready(perf) ? (
      <QuoteText value={get(perf)} neutral={stealth} />
    ) : (
      <span className="quote-num text-[var(--fg-muted)]">—</span>
    );
}

/**
 * 搜索结果全部列（顺序即展示顺序）。数据均取自现有接口（fundgz + FundMNPeriodIncrease），不新增接口。
 * 默认隐藏列见 DEFAULT_HIDDEN，可通过列设置开关。
 */
const SEARCH_COLUMNS: SearchCol[] = [
  {
    key: "nav",
    label: cols.nav,
    width: 92,
    render: ({ perf }) =>
      perf?.hasNav ? (
        <span className="flex flex-col items-end leading-tight">
          <span className="quote-num text-[var(--fg)]">{formatNav(perf.nav)}</span>
          <span className="quote-num text-2xs text-[var(--fg-muted)]">{perf.navDate}</span>
        </span>
      ) : (
        <span className="quote-num text-[var(--fg-muted)]">—</span>
      ),
  },
  { key: "day", label: cols.day, width: 80, render: perfCell((p) => p.dayGrowth, (p) => p.hasDay) },
  { key: "week", label: cols.week, width: 80, render: perfCell((p) => p.weekGrowth, (p) => p.hasPeriod) },
  { key: "month", label: cols.m1, width: 80, render: perfCell((p) => p.monthGrowth, (p) => p.hasPeriod) },
  { key: "month3", label: cols.m3, width: 80, render: perfCell((p) => p.month3, (p) => p.hasPeriod) },
  { key: "month6", label: cols.m6, width: 80, render: perfCell((p) => p.month6, (p) => p.hasPeriod) },
  { key: "year1", label: cols.y1, width: 80, render: perfCell((p) => p.year1, (p) => p.hasPeriod) },
  { key: "year2", label: cols.y2, width: 80, render: perfCell((p) => p.year2, (p) => p.hasPeriod) },
  { key: "year3", label: cols.y3, width: 80, render: perfCell((p) => p.year3, (p) => p.hasPeriod) },
  { key: "ytd", label: cols.ytd, width: 80, render: perfCell((p) => p.ytd, (p) => p.hasPeriod) },
  { key: "since", label: cols.since, width: 84, render: perfCell((p) => p.sinceStart, (p) => p.hasPeriod) },
  {
    key: "type",
    label: cols.type,
    width: 104,
    align: "left",
    render: ({ item }) => <Badge variant="secondary">{item.type}</Badge>,
  },
];

/** 默认隐藏的列（近2年 / 成立来，避免列过多；单位净值/近6月/近3年默认展示，便于直接排序） */
const DEFAULT_HIDDEN = ["year2", "since"];

/** 列 key → 排序取值（页内排序）；返回 null 的行（数据未补全）恒排末尾 */
function searchSortValue(item: FundIndexItem, perf: FundPerf | undefined, key: string): number | string | null {
  switch (key) {
    case "name":
      return item.name;
    case "type":
      return item.type;
    case "nav":
      return perf?.hasNav ? perf.nav : null;
    case "day":
      return perf?.hasDay ? perf.dayGrowth : null;
    case "week":
      return perf?.hasPeriod ? perf.weekGrowth : null;
    case "month":
      return perf?.hasPeriod ? perf.monthGrowth : null;
    case "month3":
      return perf?.hasPeriod ? perf.month3 : null;
    case "month6":
      return perf?.hasPeriod ? perf.month6 : null;
    case "year1":
      return perf?.hasPeriod ? perf.year1 : null;
    case "year2":
      return perf?.hasPeriod ? perf.year2 : null;
    case "year3":
      return perf?.hasPeriod ? perf.year3 : null;
    case "ytd":
      return perf?.hasPeriod ? perf.ytd : null;
    case "since":
      return perf?.hasPeriod ? perf.sinceStart : null;
    default:
      return null;
  }
}

const TABLE_ID = "search";

/**
 * 搜索页：基金 + 基金公司统一模糊搜索（本地索引：代码 / 名称 / 拼音首字母 / 公司前缀）。
 * 默认搜索框垂直居中；输入关键字后搜索框上移至顶部，下方展示结果表格（含阶段收益异步补全 + 列显隐）。
 * 该页在主窗口常驻挂载（非激活时隐藏），切走再回来时上次搜索结果仍保留。
 */
export function SearchPage({ visible }: { visible: boolean }) {
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  // 基金类型筛选（常驻保持，切走再回来不重置）
  const [fundType, setFundType] = useState<FundType>("all");
  const searching = keyword.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useSearchHistoryStore((s) => s.items);
  const pushHistory = useSearchHistoryStore((s) => s.push);
  const removeHistory = useSearchHistoryStore((s) => s.remove);
  const clearHistory = useSearchHistoryStore((s) => s.clear);

  // 输入防抖：停顿 250ms 自动提交搜索
  useEffect(() => {
    const id = window.setTimeout(() => setKeyword(input.trim()), 250);
    return () => window.clearTimeout(id);
  }, [input]);

  // 切到本页时自动聚焦输入框（常驻挂载，不能用 autoFocus）
  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col p-[var(--size-padding)]",
        searching ? "gap-[var(--size-gap)]" : "items-center justify-center gap-3",
        !visible && "hidden"
      )}
    >
      {/* 搜索输入框：默认居中放大，搜索时上移并铺满 */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3 transition-all duration-300 focus-within:border-[var(--accent)]",
          searching ? "h-[var(--size-input)] w-full" : "h-12 w-full max-w-2xl px-4"
        )}
      >
        <Search size={searching ? 15 : 19} className="shrink-0 text-[var(--fg-muted)]" />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") pushHistory(input);
          }}
          onBlur={() => pushHistory(input)}
          placeholder={zhCN.searchPage.placeholder}
          className={cn(
            "h-full w-full bg-transparent text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]",
            searching ? "text-[length:var(--size-font-sm)]" : "text-[length:var(--size-font-base)]"
          )}
        />
        {input && (
          <button
            aria-label={zhCN.common.cancel}
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {searching ? (
        <SearchResults keyword={keyword} fundType={fundType} onTypeChange={setFundType} />
      ) : (
        <div className="flex w-full max-w-xl flex-col items-center gap-3">
          {history.length > 0 && (
            <div className="flex w-full flex-col items-center gap-1.5">
              <div className="flex items-center gap-2 text-2xs text-[var(--fg-muted)]">
                <span>{zhCN.searchPage.recent}</span>
                <button
                  onClick={clearHistory}
                  className="rounded-[var(--radius-sm)] px-1 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                >
                  {zhCN.common.clear}
                </button>
              </div>
              {/* 搜索记录胶囊：点击回填并触发搜索；悬浮显示删除按钮，配色弱化不抢视觉 */}
              <div className="flex flex-wrap justify-center gap-1.5">
                {history.map((h) => (
                  <span
                    key={h}
                    className="group/cap flex max-w-[200px] items-center gap-1 rounded-full bg-[var(--surface-secondary)]/60 py-1 pl-2.5 pr-1.5 text-2xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--fg-secondary)]"
                  >
                    <button
                      onClick={() => {
                        setInput(h);
                        inputRef.current?.focus();
                      }}
                      className="min-w-0 truncate"
                    >
                      {h}
                    </button>
                    {/* 删除单条历史：悬浮该胶囊时出现 */}
                    <button
                      aria-label={zhCN.common.clear}
                      onClick={() => removeHistory(h)}
                      className="shrink-0 rounded-full p-0.5 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover/cap:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 搜索结果列表：本地索引一次性取齐命中（名称/代码/拼音/公司前缀匹配）+ 类型筛选，
 * 默认不排序（保持命中原始顺序）；点击列头时对「全部命中结果」排序，再做客户端分页与列显隐。 */
function SearchResults({
  keyword,
  fundType,
  onTypeChange,
}: {
  keyword: string;
  fundType: FundType;
  onTypeChange: (t: FundType) => void;
}) {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const hidden = useColumnsStore((s) => s.hidden[TABLE_ID]) ?? DEFAULT_HIDDEN;
  const ensure = useColumnsStore((s) => s.ensure);
  useEffect(() => ensure(TABLE_ID, DEFAULT_HIDDEN), [ensure]);

  // 一次性取齐全部命中（最多 searchAllMax 条）+ 真实总数，供全量排序
  const [allItems, setAllItems] = useState<FundIndexItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setPageIndex(1);
    void call("搜索基金", () => FundService.SearchFundsAll(keyword, fundType)).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res) {
        setFailed(true);
        setAllItems([]);
        setTotal(0);
        return;
      }
      setAllItems(res.items ?? []);
      setTotal(res.total ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [keyword, fundType]);

  // 搜索即**预加载全部命中的收益**（最多 300 条，分批渐进合并到内存）：
  // 之后点排序、翻页都直接在已加载的全量数据上做（切片/排序），无需再等待。主题标签仍仅按当前页加载（不参与排序）。
  const allCodes = useMemo(() => allItems.map((it) => it.code), [allItems]);
  const perfMap = useFundPerformance(allCodes);

  // 排序：默认不排序（保持命中原始顺序）；点击列头作用于全部结果，循环 降序 → 升序 → 取消。
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const sorting = !!(sortKey && sortDir);
  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
    setPageIndex(1);
  };

  const sortedItems = useMemo(() => {
    if (!sorting) return allItems; // 默认/取消排序：保持命中原始顺序
    const factor = sortDir === "asc" ? 1 : -1;
    return [...allItems].sort((a, b) => {
      const va = searchSortValue(a, perfMap[a.code], sortKey);
      const vb = searchSortValue(b, perfMap[b.code], sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // 未补全数据恒排末尾
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "zh-CN") * factor;
    });
  }, [allItems, sortKey, sortDir, perfMap]);

  // 客户端分页：在已排序的全量结果上切片
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / SEARCH_PAGE_SIZE));
  const pageItems = useMemo(
    () => sortedItems.slice((pageIndex - 1) * SEARCH_PAGE_SIZE, pageIndex * SEARCH_PAGE_SIZE),
    [sortedItems, pageIndex]
  );
  const pageCodes = useMemo(() => pageItems.map((it) => it.code), [pageItems]);
  const themesMap = useFundThemes(pageCodes);
  const empty = !loading && !failed && allItems.length === 0;
  const truncated = total > allItems.length;

  const visibleCols = SEARCH_COLUMNS.filter((c) => !hidden.includes(c.key));
  const tableWidth = RANK_W + NAME_W + ACTION_W + visibleCols.reduce((sum, c) => sum + c.width, 0);

  return (
    <>
      {/* 工具栏：类型筛选（与基金排行一致）+ 列设置 */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-none">
          {(Object.keys(zhCN.ranking.types) as FundType[]).map((t) => (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              className={cn(
                "h-[var(--size-tab)] shrink-0 rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                t === fundType
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.ranking.types[t]}
            </button>
          ))}
        </div>
        <ColumnToggle
          tableId={TABLE_ID}
          columns={[
            { key: "name", label: cols.name, required: true },
            ...SEARCH_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
          ]}
        />
      </div>

      {/* 结果状态条 */}
      <div className="flex items-center gap-2 text-2xs text-[var(--fg-muted)]">
        <span className="min-w-0 flex-1">
          {zhCN.searchPage.result}
          {total > 0 && (
            <span className="ml-1 text-[var(--fg-secondary)]">{zhCN.ranking.searchTotal.replace("{n}", String(total))}</span>
          )}
          {truncated && (
            <span className="ml-2 text-[var(--warning)]">
              {zhCN.searchPage.truncated.replace("{n}", String(allItems.length))}
            </span>
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
          <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%", minWidth: tableWidth }}>
            <colgroup>
              <col style={{ width: RANK_W }} />
              <col style={{ width: NAME_W }} />
              {visibleCols.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
              <col style={{ width: ACTION_W }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-grid-header border-b text-right">{cols.rank}</th>
                <SortableHeader
                  label={cols.name}
                  align="left"
                  active={sortKey === "name"}
                  dir={sortKey === "name" ? sortDir : null}
                  onClick={() => toggleSort("name")}
                />
                {visibleCols.map((c) => (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    align={c.align === "left" ? "left" : "right"}
                    active={sortKey === c.key}
                    dir={sortKey === c.key ? sortDir : null}
                    onClick={() => toggleSort(c.key)}
                  />
                ))}
                <th className="data-grid-header border-b text-center">{cols.actions}</th>
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-50")}>
              {pageItems.map((item, i) => (
                <SearchRow
                  key={item.code}
                  item={item}
                  rank={(pageIndex - 1) * SEARCH_PAGE_SIZE + i + 1}
                  themes={themesMap[item.code]}
                  perf={perfMap[item.code]}
                  stealth={stealth}
                  visibleCols={visibleCols}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pager pageIndex={pageIndex} totalPages={totalPages} loading={loading} onGoto={setPageIndex} />
    </>
  );
}

/** 搜索结果行：基金名称 + 代码 + 主题标签、可见数据列、加自选 / 详情 */
function SearchRow({
  item,
  rank,
  themes,
  perf,
  stealth,
  visibleCols,
}: {
  item: FundIndexItem;
  rank: number;
  themes?: FundTheme[];
  perf?: FundPerf;
  stealth: boolean;
  visibleCols: SearchCol[];
}) {
  const addFund = useWatchlistStore((s) => s.addFund);
  const ctx: CellCtx = { item, perf, stealth };
  return (
    <tr
      className="group hover:bg-[var(--row-hover)]"
      onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
    >
      <td className="data-grid-cell text-right text-[var(--fg-muted)]">{rank}</td>
      <td className="data-grid-cell">
        <div className="flex flex-col gap-0.5 py-0.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
            <ThemeChips themes={themes} className="ml-auto" />
          </div>
          <div className="flex items-center gap-1">
            <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
            <CopyButton value={item.code} name={item.name} />
          </div>
        </div>
      </td>
      {visibleCols.map((c) => (
        <td key={c.key} className={cn("data-grid-cell", c.align === "left" ? "text-left" : "text-right")}>
          {c.render(ctx)}
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
