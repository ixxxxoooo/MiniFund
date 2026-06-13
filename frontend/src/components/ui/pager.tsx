import { ChevronLeft, ChevronRight } from "lucide-react";
import { zhCN } from "@/i18n/zh-CN";

/** 通用分页器：上一页 / 当前页/总页 / 下一页（排行、快讯、自选共用） */
export function Pager({
  pageIndex,
  totalPages,
  loading = false,
  onGoto,
}: {
  pageIndex: number;
  totalPages: number;
  loading?: boolean;
  onGoto: (idx: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
      <button
        disabled={pageIndex <= 1 || loading}
        onClick={() => onGoto(pageIndex - 1)}
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
        onClick={() => onGoto(pageIndex + 1)}
        className="flex items-center gap-0.5 rounded-[var(--radius-btn)] px-2 py-1 hover:bg-[var(--row-hover)] disabled:opacity-40"
      >
        {zhCN.ranking.nextPage}
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
