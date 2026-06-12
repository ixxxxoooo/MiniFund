import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { FundIndexItem } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

/**
 * 基金搜索面板（Cmd+K 唤起）：
 * 本地索引模糊搜索 → 键盘上下选择 → Enter 加自选 / 点击查看详情。
 */
export function SearchPalette() {
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const addFund = useWatchlistStore((s) => s.addFund);
  const watchedCodes = useWatchlistStore((s) => s.items.map((i) => i.code).join(","));

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<FundIndexItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<number>();

  // 全局 Cmd+K 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  // 防抖搜索（200ms）
  useEffect(() => {
    if (!open) return;
    window.clearTimeout(debounceRef.current);
    if (!keyword.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void call("搜索基金", () => FundService.SearchFunds(keyword, 20)).then((list) => {
        setResults(list ?? []);
        setSelected(0);
        setSearched(true);
      });
    }, 200);
  }, [keyword, open]);

  // 关闭时重置
  useEffect(() => {
    if (!open) {
      setKeyword("");
      setResults([]);
      setSelected(0);
      setSearched(false);
    }
  }, [open]);

  const watched = new Set(watchedCodes.split(",").filter(Boolean));

  const handleAdd = useCallback(
    (item: FundIndexItem) => {
      void addFund(item.code);
    },
    [addFund]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      handleAdd(results[selected]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showClose={false} className="top-[120px] w-[520px] translate-y-0 p-0" aria-describedby={undefined}>
        {/* Radix 要求 Content 内有 Title，用视觉隐藏满足可访问性 */}
        <span className="sr-only" id="search-title">
          {zhCN.main.searchPlaceholder}
        </span>
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3">
          <Search size={15} className="shrink-0 text-[var(--fg-muted)]" />
          <input
            autoFocus
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={zhCN.search.placeholder}
            className="h-[40px] w-full bg-transparent text-[length:var(--size-font-sm)] text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
          />
        </div>

        <div className="scroll-always max-h-[320px] overflow-y-auto p-1">
          {searched && results.length === 0 && (
            <div className="py-8 text-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
              {zhCN.search.empty}
            </div>
          )}
          {results.map((item, i) => {
            const isWatched = watched.has(item.code);
            return (
              <div
                key={item.code}
                onMouseEnter={() => setSelected(i)}
                onClick={() => handleAdd(item)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5",
                  i === selected && "bg-[var(--row-selected)]"
                )}
              >
                <span className="quote-num w-[52px] shrink-0 text-2xs text-[var(--fg-secondary)]">{item.code}</span>
                <span className="min-w-0 flex-1 truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">
                  {item.name}
                </span>
                <Badge variant="secondary">{item.type}</Badge>
                {isWatched ? (
                  <span className="shrink-0 text-2xs text-[var(--fg-muted)]">{zhCN.search.added}</span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAdd(item);
                    }}
                    className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--accent)] hover:bg-[var(--row-hover)]"
                  >
                    <Plus size={11} />
                    {zhCN.search.add}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code));
                    setOpen(false);
                  }}
                  className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                >
                  {zhCN.search.detail}
                </button>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--border-subtle)] px-3 py-1.5 text-2xs text-[var(--fg-muted)]">
          {zhCN.search.hint}
        </div>
      </DialogContent>
    </Dialog>
  );
}
