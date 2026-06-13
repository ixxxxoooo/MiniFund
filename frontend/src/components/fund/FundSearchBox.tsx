import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { FundIndexItem } from "@bindings/minifund/internal/model";
import { FundService, WindowService } from "@bindings/minifund/services";
import { Badge } from "@/components/ui/badge";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useWatchlistStore } from "@/stores/watchlist";

/**
 * 内嵌基金搜索框：本地零延迟索引模糊搜索，结果下拉可加自选 / 进详情。
 * 用于排行、主题等页面，提供独立于 ⌘K 命令面板的就地搜索能力。
 */
export function FundSearchBox({ className }: { className?: string }) {
  const addFund = useWatchlistStore((s) => s.addFund);
  const watchedCodes = useWatchlistStore((s) => s.items.map((i) => i.code).join(","));
  const watched = new Set(watchedCodes.split(",").filter(Boolean));

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<FundIndexItem[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number>();
  const ref = useRef<HTMLDivElement>(null);

  // 防抖搜索
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (!keyword.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void call("搜索基金", () => FundService.SearchFunds(keyword, 12, 0)).then((list) => {
        setResults(list ?? []);
        setOpen(true);
      });
    }, 200);
  }, [keyword]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div className="flex h-[var(--size-input-sm)] items-center gap-1.5 rounded-[var(--radius-input)] border border-[var(--border-subtle)] bg-[var(--surface)] px-2 focus-within:border-[var(--accent)]">
        <Search size={12} className="shrink-0 text-[var(--fg-muted)]" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={zhCN.ranking.searchPlaceholder}
          className="h-full w-full bg-transparent text-2xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
        />
        {keyword && (
          <button
            aria-label={zhCN.common.cancel}
            onClick={() => {
              setKeyword("");
              setResults([]);
              setOpen(false);
            }}
            className="shrink-0 rounded-full p-0.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {open && keyword.trim() && (
        <div className="scroll-always absolute left-0 top-[calc(var(--size-input-sm)+4px)] z-30 max-h-72 w-80 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] p-1 shadow-[var(--shadow-md)]">
          {results.length === 0 ? (
            <div className="py-4 text-center text-2xs text-[var(--fg-muted)]">{zhCN.search.empty}</div>
          ) : (
            results.map((item) => (
              <div
                key={item.code}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--row-hover)]"
              >
                <span className="quote-num w-[52px] shrink-0 text-2xs text-[var(--fg-secondary)]">{item.code}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-[var(--fg)]">{item.name}</span>
                <Badge variant="secondary">{item.type}</Badge>
                {watched.has(item.code) ? (
                  <span className="shrink-0 text-2xs text-[var(--fg-muted)]">{zhCN.search.added}</span>
                ) : (
                  <button
                    onClick={() => void addFund(item.code)}
                    className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--accent)] hover:bg-[var(--row-selected)]"
                  >
                    <Plus size={11} />
                    {zhCN.search.add}
                  </button>
                )}
                <button
                  onClick={() => void call("打开详情窗口", () => WindowService.OpenDetailWindow(item.code))}
                  className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                >
                  {zhCN.search.detail}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
