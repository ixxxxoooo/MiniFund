import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FolderInput, Trash2, Wallet } from "lucide-react";
import type { WatchItem } from "@bindings/minifund/internal/model";
import { WindowService } from "@bindings/minifund/services";
import { CopyButton, PositionStatusBadge, ThemeChips, useFundThemes } from "@/components/fund/fund-list-helpers";
import { FundNameCell } from "@/components/fund/FundNameCell";
import { QuoteText } from "@/components/market/QuoteText";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pager } from "@/components/ui/pager";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { formatMoney, formatNav, formatPercent } from "@/lib/format";
import { computePositionMetrics } from "@/lib/portfolio";
import { useLocalSort } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { isSummaryGroup, useWatchlistStore } from "@/stores/watchlist";

/** 自选表格每页条数兜底值（容器高度测量前/异常时使用） */
const WATCH_PAGE_SIZE_FALLBACK = 20;

interface WatchlistTableProps {
  /** 点击"持仓"按钮回调（弹出持仓编辑） */
  onEditPosition: (item: WatchItem) => void;
}

/**
 * 自选估值表格：估值/涨跌幅事件驱动刷新，数值变化带闪烁动画，列头点击本地排序。
 */
export function WatchlistTable({ onEditPosition }: WatchlistTableProps) {
  const items = useWatchlistStore((s) => s.items);
  const positions = useWatchlistStore((s) => s.positions);
  const removeFund = useWatchlistStore((s) => s.removeFund);
  const estimates = useMarketStore((s) => s.estimates);
  const updatedAt = useMarketStore((s) => s.estimatesUpdatedAt);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const hideAmounts = useUIStore((s) => s.hideAmounts);

  // 记录上一轮估值，用于判断闪烁方向
  const prevRef = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
  // 待确认移除的基金代码（应用内确认弹窗，替代 Wails WebView 不支持的 window.confirm）
  const [removeCode, setRemoveCode] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const [code, est] of Object.entries(estimates)) {
      const prev = prevRef.current[code];
      if (prev != null && est.estimate !== prev) {
        next[code] = est.estimate > prev ? "up" : "down";
      }
      prevRef.current[code] = est.estimate;
    }
    if (Object.keys(next).length > 0) {
      setFlashes(next);
      const timer = window.setTimeout(() => setFlashes({}), 700);
      return () => window.clearTimeout(timer);
    }
  }, [updatedAt, estimates]);

  // 派生指标统一在此计算，供表格与排序复用（当日收益盘中/盘后兜底见 lib/portfolio）
  const metrics = (item: WatchItem) => {
    const est = estimates[item.code];
    const pos = positions[item.code];
    return { est, pos, ...computePositionMetrics(est, pos) };
  };

  // 当前分组持仓总市值（持仓占比分母，按全部条目而非当前页计算）
  const groupMarketValue = useMemo(() => {
    let total = 0;
    for (const it of items) {
      const m = computePositionMetrics(estimates[it.code], positions[it.code]);
      if (m.marketValue != null) total += m.marketValue;
    }
    return total;
  }, [items, estimates, positions]);

  // 默认按加入时间倒序（最新在前）；列头排序可覆盖该默认顺序
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items]
  );

  const { sorted, sortState, toggle } = useLocalSort(orderedItems, {
    name: (it) => it.name || it.code,
    nav: (it) => estimates[it.code]?.prevNav ?? -Infinity,
    estimate: (it) => {
      const est = estimates[it.code];
      return est?.hasEstimate ? est.estimate : -Infinity;
    },
    todayGrowth: (it) => {
      const est = estimates[it.code];
      if (est?.hasEstimate) return est.estimateGrowth;
      if (est?.hasDayGrowth) return est.dayGrowth;
      return -Infinity;
    },
    todayProfit: (it) => metrics(it).todayProfit ?? -Infinity,
    marketValue: (it) => metrics(it).marketValue ?? -Infinity,
    marketShare: (it) => metrics(it).marketValue ?? -Infinity,
    holdingProfit: (it) => metrics(it).totalProfit ?? -Infinity,
    holdingCost: (it) => metrics(it).costValue ?? -Infinity,
  });

  // 分页：每页条数按表格可视高度自适应（窗口越大每页越多），越界时自动钳制
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(WATCH_PAGE_SIZE_FALLBACK);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => {
      const headerH = el.querySelector("thead")?.getBoundingClientRect().height ?? 30;
      const rowH = el.querySelector("tbody tr")?.getBoundingClientRect().height ?? 40;
      const avail = el.clientHeight - headerH;
      if (rowH > 0 && avail > 0) setPageSize(Math.max(5, Math.floor(avail / rowH)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageItems = sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  // 当前页基金的所属主题标签（异步加载、带缓存，与排行/搜索同源同配色）
  const pageCodes = useMemo(() => pageItems.map((it) => it.code), [pageItems]);
  const themesMap = useFundThemes(pageCodes);

  const hidden = hideAmounts || stealth;
  const cols = zhCN.watchlist.columns;
  const header = (key: string, label: string, align: "left" | "right" = "right") => (
    <SortableHeader
      label={label}
      align={align}
      active={sortState.key === key}
      dir={sortState.key === key ? sortState.dir : null}
      onClick={() => toggle(key)}
    />
  );

  return (
    <>
    <div ref={scrollRef} className="scroll-always min-h-0 flex-1 overflow-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            {header("name", cols.name, "left")}
            {header("todayGrowth", cols.todayGrowth)}
            {header("nav", cols.nav)}
            {header("estimate", cols.estimate)}
            {header("todayProfit", cols.todayProfit)}
            {header("marketValue", cols.marketValue)}
            {header("marketShare", cols.marketShare)}
            {header("holdingProfit", cols.holdingProfit)}
            {header("holdingCost", cols.holdingCost)}
            <th className="data-grid-header border-b text-center">{cols.actions}</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((item) => {
            const { est, pos, todayProfit, marketValue, totalProfit, totalPercent, costValue } = metrics(item);
            const marketShare =
              marketValue != null && groupMarketValue > 0 ? (marketValue / groupMarketValue) * 100 : null;
            const flash = flashes[item.code];

            return (
              <tr
                key={item.code}
                className={cn(
                  "group hover:bg-[var(--row-hover)]",
                  flash === "up" && "quote-flash-up",
                  flash === "down" && "quote-flash-down"
                )}
                onDoubleClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
              >
                <td className="data-grid-cell">
                  <FundNameCell code={item.code} name={item.name || est?.name || item.code}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">
                        {item.name || est?.name || item.code}
                      </span>
                      <ThemeChips themes={themesMap[item.code]} className="ml-auto" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="quote-num text-2xs text-[var(--fg-muted)]">{item.code}</span>
                      <PositionStatusBadge code={item.code} />
                      <CopyButton value={item.code} name={item.name} />
                    </div>
                  </FundNameCell>
                </td>
                <td className="data-grid-cell text-right">
                  {est?.hasEstimate ? (
                    <QuoteText value={est.estimateGrowth} neutral={stealth} />
                  ) : est?.hasDayGrowth ? (
                    <QuoteText value={est.dayGrowth} neutral={stealth} />
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  <div className="flex flex-col items-end py-0.5">
                    <span className="quote-num">{est ? formatNav(est.prevNav) : zhCN.watchlist.noEstimate}</span>
                    <span className="quote-num text-2xs text-[var(--fg-muted)]">{est?.navDate ?? ""}</span>
                  </div>
                </td>
                <td className="data-grid-cell text-right">
                  <span className="quote-num">{est?.hasEstimate ? formatNav(est.estimate) : zhCN.watchlist.noEstimate}</span>
                </td>
                <td className="data-grid-cell text-right">
                  {todayProfit != null ? (
                    <QuoteText value={todayProfit} text={formatMoney(todayProfit, hidden)} neutral={stealth} />
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  <span className="quote-num">{marketValue != null ? formatMoney(marketValue, hidden) : zhCN.watchlist.noEstimate}</span>
                </td>
                <td className="data-grid-cell text-right">
                  {marketShare != null ? (
                    <span className="quote-num text-[var(--fg-secondary)]">{marketShare.toFixed(2)}%</span>
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  {totalProfit != null ? (
                    <div className="flex flex-col items-end py-0.5">
                      <QuoteText value={totalProfit} text={formatMoney(totalProfit, hidden)} neutral={stealth} />
                      {totalPercent != null && (
                        <QuoteText
                          value={totalPercent}
                          text={formatPercent(totalPercent)}
                          neutral={stealth}
                          className="text-2xs"
                        />
                      )}
                    </div>
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell text-right">
                  {pos && costValue != null ? (
                    <div className="flex flex-col items-end py-0.5">
                      <span className="quote-num">{formatMoney(costValue, hidden)}</span>
                      <span className="quote-num text-2xs text-[var(--fg-muted)]">{formatNav(pos.costPrice)}</span>
                    </div>
                  ) : (
                    zhCN.watchlist.noEstimate
                  )}
                </td>
                <td className="data-grid-cell">
                  <div className="flex items-center justify-center gap-1">
                    <RowAction
                      label={zhCN.watchlist.actionDetail}
                      onClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                    >
                      <ExternalLink size={12} />
                    </RowAction>
                    <RowAction label={zhCN.watchlist.actionPosition} onClick={() => onEditPosition(item)}>
                      <Wallet size={12} />
                    </RowAction>
                    <MoveMenu code={item.code} />
                    <RowAction label={zhCN.watchlist.actionRemove} onClick={() => setRemoveCode(item.code)}>
                      <Trash2 size={12} />
                    </RowAction>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {sorted.length > pageSize && (
      <Pager pageIndex={pageClamped} totalPages={totalPages} onGoto={setPage} />
    )}
    <ConfirmDialog
      open={removeCode != null}
      title={zhCN.watchlist.actionRemove}
      message={zhCN.watchlist.removeConfirm}
      confirmLabel={zhCN.watchlist.actionRemove}
      danger
      onConfirm={() => {
        if (removeCode) void removeFund(removeCode);
        setRemoveCode(null);
      }}
      onCancel={() => setRemoveCode(null)}
    />
    </>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        onClick={onClick}
        className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-selected)] hover:text-[var(--fg)]"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * 移动到分组：下拉列出其他分组，点击即移动当前基金。
 * 下拉菜单通过 Portal 渲染到 body，并用 fixed 定位，避免被自选表格的 overflow-auto 容器裁剪遮挡。
 */
function MoveMenu({ code }: { code: string }) {
  const groups = useWatchlistStore((s) => s.groups);
  const activeGroupId = useWatchlistStore((s) => s.activeGroupId);
  const moveFund = useWatchlistStore((s) => s.moveFund);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 「汇总」非真实分组，不能作为移动目标
  const others = groups.filter((g) => g.id !== activeGroupId && !isSummaryGroup(g.id));
  // 只有一个分组时无处可移；「汇总」视图下来源分组不明确，禁用移动
  const disabled = others.length === 0 || isSummaryGroup(activeGroupId);

  const MENU_W = 128;
  // 打开时按按钮位置计算固定坐标：右对齐按钮、优先在下方展开，下方空间不足则向上展开
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const estHeight = Math.min(others.length * 28 + 26, 240);
    const openUp = r.bottom + estHeight + 8 > window.innerHeight;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const top = openUp ? r.top - estHeight - 4 : r.bottom + 4;
    setPos({ left, top });
  }, [open, others.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", handler);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <Tooltip content={zhCN.watchlist.actionMove}>
        <button
          ref={btnRef}
          aria-label={zhCN.watchlist.actionMove}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-selected)] hover:text-[var(--fg)] disabled:opacity-30 disabled:hover:bg-transparent",
            open && "bg-[var(--row-selected)] text-[var(--accent)]"
          )}
        >
          <FolderInput size={12} />
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", left: pos.left, top: pos.top, width: MENU_W }}
            className="z-[100] max-h-60 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] py-1 shadow-[var(--shadow-lg)]"
          >
            <div className="px-3 py-0.5 text-2xs text-[var(--fg-muted)]">{zhCN.watchlist.moveTitle}</div>
            {others.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setOpen(false);
                  void moveFund(code, g.id);
                }}
                className="block w-full truncate px-3 py-1 text-left text-2xs text-[var(--fg)] hover:bg-[var(--row-hover)]"
              >
                {g.name}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
