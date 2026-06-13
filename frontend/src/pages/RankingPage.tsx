import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import type { FundIndexItem, FundIndexPage, FundTheme, RankItem, RankPage } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { Badge } from "@/components/ui/badge";
import { QuoteText } from "@/components/market/QuoteText";
import { ColumnToggle } from "@/components/ui/column-toggle";
import { Pager } from "@/components/ui/pager";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatNav, formatScale } from "@/lib/format";
import { usePrefetchPager } from "@/lib/pager";
import { cn } from "@/lib/utils";
import { useColumnsStore } from "@/stores/columns";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

type FundType = keyof typeof zhCN.ranking.types;

/** 排行列定义：可选 sortKey 表示该列支持服务端排序（点列头切换升降序） */
interface RankCol {
  key: string;
  label: string;
  /** 固定列宽（px），配合 table-layout:fixed 保证列宽稳定不抖动 */
  width: number;
  /** 服务端排序键（与后端白名单一致）；省略则为展示列 */
  sortKey?: string;
  /** 涨跌幅取值（用 QuoteText 渲染红绿） */
  quote?: (r: RankItem) => number;
  /** 普通文本取值 */
  text?: (r: RankItem) => ReactNode;
}

const cols = zhCN.ranking.columns;

/** 固定列宽（px）：序号 / 基金名称（含主题标签行）/ 操作列 */
const RANK_W = 46;
const NAME_W = 248;
const ACTION_W = 96;

/** 排行全部列（顺序即展示顺序）；默认隐藏列见 DEFAULT_HIDDEN */
const RANK_COLUMNS: RankCol[] = [
  {
    // 单位净值 + 净值日期合并一列：净值在上、日期在下（与「基金名称」列风格一致）
    key: "nav",
    label: cols.nav,
    width: 92,
    text: (r) => (
      <span className="flex flex-col items-end leading-tight">
        <span className="quote-num text-[var(--fg)]">{formatNav(r.nav)}</span>
        <span className="quote-num text-2xs text-[var(--fg-muted)]">{r.date}</span>
      </span>
    ),
  },
  { key: "accNav", label: cols.accNav, width: 84, text: (r) => formatNav(r.accNav) },
  { key: "rzdf", label: cols.day, width: 80, sortKey: "rzdf", quote: (r) => r.dayGrowth },
  { key: "zzf", label: cols.week, width: 80, sortKey: "zzf", quote: (r) => r.weekGrowth },
  { key: "1yzf", label: cols.m1, width: 80, sortKey: "1yzf", quote: (r) => r.monthGrowth },
  { key: "3yzf", label: cols.m3, width: 80, sortKey: "3yzf", quote: (r) => r.month3 },
  { key: "6yzf", label: cols.m6, width: 80, sortKey: "6yzf", quote: (r) => r.month6 },
  { key: "1nzf", label: cols.y1, width: 80, sortKey: "1nzf", quote: (r) => r.year1 },
  { key: "year2", label: cols.y2, width: 80, quote: (r) => r.year2 },
  { key: "3nzf", label: cols.y3, width: 80, sortKey: "3nzf", quote: (r) => r.year3 },
  { key: "jnzf", label: cols.ytd, width: 80, sortKey: "jnzf", quote: (r) => r.ytd },
  { key: "since", label: cols.since, width: 84, quote: (r) => r.sinceStart },
  { key: "scale", label: cols.scale, width: 104, text: (r) => formatScale(r.scale) },
];

/** 默认隐藏的列（累计净值 / 近2年 / 近3年，避免列过多） */
const DEFAULT_HIDDEN = ["accNav", "year2", "year3"];

const TABLE_ID = "ranking";

/** 每页条数：与后端 FundMNRank 单页上限保持一致 */
const RANK_PAGE_SIZE = 30;
/** 就地搜索每页条数：与后端 rankSearchPageSize 保持一致 */
const SEARCH_PAGE_SIZE = 30;

/**
 * 基金排行页：类型筛选 + 就地搜索 + 列显隐设置 + 列头服务端排序 + 分页。
 * 字段参考天天基金开放式基金排行（含成立来、规模）。双击行打开详情。
 * 搜索框输入关键字（代码/名称/拼音/公司前缀）后回车或停顿即在列表内分页展示，
 * 不会直接加入自选；清空搜索框回到完整排行榜。
 */
export function RankingPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const addFund = useWatchlistStore((s) => s.addFund);
  const hidden = useColumnsStore((s) => s.hidden[TABLE_ID]) ?? DEFAULT_HIDDEN;
  const ensure = useColumnsStore((s) => s.ensure);
  useEffect(() => ensure(TABLE_ID, DEFAULT_HIDDEN), [ensure]);

  const [fundType, setFundType] = useState<FundType>("all");
  const [sortKey, setSortKey] = useState("rzdf");
  const [sortType, setSortType] = useState<"desc" | "asc">("desc");

  // 就地搜索：searchInput 为输入框原始值，searchKeyword 为提交后的关键字（防抖 / 回车提交）
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const searching = searchKeyword.trim().length > 0;

  // 输入防抖：停顿 250ms 自动提交搜索（回车则立即提交，见下方 onKeyDown）
  useEffect(() => {
    const id = window.setTimeout(() => setSearchKeyword(searchInput.trim()), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // 分页加载 + 下一页后台预取（翻页零等待）；筛选/排序变化自动回第 1 页
  const { page, pageIndex, loading, failed, goto } = usePrefetchPager<RankPage>(
    (pi) => call("加载基金排行", () => FundService.GetFundRanking(fundType, sortKey, sortType, pi)),
    `${fundType}|${sortKey}|${sortType}`
  );

  /** 列头点击：同列切换方向，异列重置为降序 */
  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortType((t) => (t === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortType("desc");
    }
  };

  /** 切换类型筛选：同时退出搜索模式回到排行 */
  const handleType = (t: FundType) => {
    setFundType(t);
    setSearchInput("");
    setSearchKeyword("");
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchKeyword("");
  };

  // 当前页基金的所属主题标签（异步加载、带缓存）
  const pageCodes = useMemo(() => (page?.items ?? []).map((it) => it.code), [page]);
  const themesMap = useFundThemes(pageCodes);

  const visibleCols = RANK_COLUMNS.filter((c) => !hidden.includes(c.key));
  const totalPages = page ? Math.max(1, Math.ceil(page.total / RANK_PAGE_SIZE)) : 1;
  // 表格固定总宽：序号 + 名称 + 可见列之和 + 操作列；width:100% 自适应填满，min-width 触发横向滚动
  const tableWidth = RANK_W + NAME_W + ACTION_W + visibleCols.reduce((sum, c) => sum + c.width, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      {/* 工具栏：类型筛选 + 就地搜索 + 列设置 */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-none">
          {(Object.keys(zhCN.ranking.types) as FundType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleType(t)}
              className={cn(
                "h-[var(--size-tab)] shrink-0 rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                !searching && t === fundType
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.ranking.types[t]}
            </button>
          ))}
        </div>
        {/* 就地搜索框：回车只在列表展示，不加自选 */}
        <div className="flex h-[var(--size-input-sm)] w-60 shrink-0 items-center gap-1.5 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-2 focus-within:border-[var(--accent)]">
          <Search size={12} className="shrink-0 text-[var(--fg-muted)]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSearchKeyword(searchInput.trim());
              } else if (e.key === "Escape") {
                clearSearch();
              }
            }}
            placeholder={zhCN.ranking.searchPlaceholder}
            className="h-full w-full bg-transparent text-2xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
          />
          {searchInput && (
            <button
              aria-label={zhCN.ranking.exitSearch}
              onClick={clearSearch}
              className="shrink-0 rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <ColumnToggle
          tableId={TABLE_ID}
          columns={[
            { key: "name", label: cols.name, required: true },
            ...RANK_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
          ]}
        />
      </div>

      {searching ? (
        <SearchResultsView keyword={searchKeyword} onExit={clearSearch} />
      ) : (
        <>
          {fundType === "qdii" && (
            <div className="text-2xs text-[var(--fg-muted)]">{zhCN.ranking.qdiiLimitHint}</div>
          )}

          {/* 排行表格 */}
          <div className="scroll-always relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
            {/* 加载动画：加载中居中展示（半透明遮罩，旧数据仍可见） */}
            {loading && !failed && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--surface)]/60 backdrop-blur-[1px]">
                <Spinner size={22} label={zhCN.ranking.loading} />
              </div>
            )}
            {failed ? (
              <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
                {zhCN.ranking.loadFailed}
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
                    <th className="data-grid-header border-b">{cols.name}</th>
                    {visibleCols.map((c) =>
                      c.sortKey ? (
                        <SortableHeader
                          key={c.key}
                          label={c.label}
                          active={sortKey === c.sortKey}
                          dir={sortKey === c.sortKey ? sortType : null}
                          onClick={() => handleSort(c.sortKey!)}
                        />
                      ) : (
                        <th key={c.key} className="data-grid-header border-b text-right">
                          {c.label}
                        </th>
                      )
                    )}
                    <th className="data-grid-header border-b text-center">{cols.actions}</th>
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
                        {(pageIndex - 1) * RANK_PAGE_SIZE + i + 1}
                      </td>
                      <td className="data-grid-cell">
                        <div className="flex flex-col gap-0.5 py-0.5">
                          <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
                          <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                          <ThemeChips themes={themesMap[item.code]} />
                        </div>
                      </td>
                      {visibleCols.map((c) => (
                        <td key={c.key} className="data-grid-cell text-right">
                          {c.quote ? (
                            <QuoteText value={c.quote(item)} neutral={stealth} />
                          ) : (
                            <span className="text-[var(--fg-secondary)]">{c.text?.(item)}</span>
                          )}
                        </td>
                      ))}
                      <td className="data-grid-cell text-center">
                        <AddButton code={item.code} onAdd={() => void addFund(item.code)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Pager pageIndex={pageIndex} totalPages={totalPages} loading={loading} onGoto={goto} />
        </>
      )}
    </div>
  );
}

/**
 * 就地搜索结果视图：本地索引分页（名称/代码/拼音/公司前缀匹配），
 * 仅展示身份列（净值/涨幅/规模等行情数据本地索引不提供）。回车只在此展示，不加自选。
 */
function SearchResultsView({ keyword, onExit }: { keyword: string; onExit: () => void }) {
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

  return (
    <>
      {/* 搜索结果状态条 */}
      <div className="flex items-center justify-between text-2xs text-[var(--fg-muted)]">
        <span>
          {zhCN.ranking.searching}
          {total > 0 && <span className="ml-1 text-[var(--fg-secondary)]">{zhCN.ranking.searchTotal.replace("{n}", String(total))}</span>}
        </span>
        <button
          onClick={onExit}
          className="rounded-[var(--radius-btn)] px-2 py-0.5 text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
        >
          {zhCN.ranking.exitSearch}
        </button>
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
          <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: RANK_W }} />
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 168 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="data-grid-header border-b text-right">{cols.rank}</th>
                <th className="data-grid-header border-b">{cols.name}</th>
                <th className="data-grid-header border-b">{cols.type}</th>
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

/** 搜索结果行：基金名称 + 代码 + 主题标签、类型、加自选 / 详情 */
function SearchRow({ item, rank, themes }: { item: FundIndexItem; rank: number; themes?: FundTheme[] }) {
  const addFund = useWatchlistStore((s) => s.addFund);
  return (
    <tr
      className="hover:bg-[var(--row-hover)]"
      onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
    >
      <td className="data-grid-cell text-right text-[var(--fg-muted)]">{rank}</td>
      <td className="data-grid-cell">
        <div className="flex flex-col gap-0.5 py-0.5">
          <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{item.name}</span>
          <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
          <ThemeChips themes={themes} />
        </div>
      </td>
      <td className="data-grid-cell">
        <Badge variant="secondary">{item.type}</Badge>
      </td>
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

/**
 * 批量加载一组基金的所属主题（code → 主题列表），缺失项由后端拉取+缓存。
 * codes 变化时增量合并，已加载过的不会闪烁。
 */
function useFundThemes(codes: string[]): Record<string, FundTheme[] | undefined> {
  const [map, setMap] = useState<Record<string, FundTheme[] | undefined>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (codes.length === 0) return;
    let cancelled = false;
    void call("加载基金主题", () => FundService.GetFundThemes(codes)).then((res) => {
      if (cancelled || !res) return;
      setMap((prev) => ({ ...prev, ...res }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/** 基金所属主题标签：最多展示 2 个，多余以 +N 折叠，hover 显示全部 */
function ThemeChips({ themes }: { themes?: FundTheme[] }) {
  if (!themes || themes.length === 0) return null;
  const shown = themes.slice(0, 2);
  const rest = themes.length - shown.length;
  return (
    <div
      className="flex items-center gap-0.5 overflow-hidden"
      title={themes.map((t) => t.name).join(" / ")}
    >
      {shown.map((t) => (
        <span
          key={t.code}
          className="truncate rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-1 py-px text-[10px] leading-tight text-[var(--fg-secondary)]"
        >
          {t.name}
        </span>
      ))}
      {rest > 0 && <span className="shrink-0 text-[10px] text-[var(--fg-muted)]">+{rest}</span>}
    </div>
  );
}

/** 加自选按钮：图标 + 「加自选」文字；已在自选中则展示「已添加」 */
function AddButton({ code, onAdd }: { code: string; onAdd: () => void }) {
  const watched = useWatchlistStore((s) => s.items.some((it) => it.code === code));
  if (watched) {
    return <span className="text-2xs text-[var(--fg-muted)]">{zhCN.search.added}</span>;
  }
  return (
    <Tooltip content={zhCN.search.add}>
      <button
        aria-label={zhCN.search.add}
        onClick={onAdd}
        className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-selected)] hover:text-[var(--accent)]"
      >
        <Plus size={12} />
        {zhCN.search.add}
      </button>
    </Tooltip>
  );
}

// 分页器已抽取为共享组件 @/components/ui/pager
