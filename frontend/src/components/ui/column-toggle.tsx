import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { cn } from "@/lib/utils";
import { useColumnsStore } from "@/stores/columns";

interface ColumnDef {
  /** 列 key（与列显隐存储一致） */
  key: string;
  /** 列名 */
  label: string;
  /** 必选列：不可隐藏（如名称、操作） */
  required?: boolean;
}

interface ColumnToggleProps {
  /** 表格 id（区分不同表格的列配置） */
  tableId: string;
  /** 全部列定义 */
  columns: ColumnDef[];
}

/**
 * 列显隐设置：下拉勾选要展示的列，配置持久化到 localStorage。
 * 必选列禁用勾选。
 */
export function ColumnToggle({ tableId, columns }: ColumnToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hidden = useColumnsStore((s) => s.hidden[tableId]) ?? [];
  const toggle = useColumnsStore((s) => s.toggle);

  // 点击面板外关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Tooltip content={zhCN.ranking.columnSettings}>
        <button
          aria-label={zhCN.ranking.columnSettings}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex h-[var(--size-input-sm)] items-center gap-1 rounded-[var(--radius-btn)] border border-[var(--border-subtle)] px-2 text-2xs",
            open ? "border-[var(--accent)] text-[var(--accent)]" : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
          )}
        >
          <SlidersHorizontal size={12} />
          {zhCN.ranking.columns_}
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 top-[calc(var(--size-input-sm)+4px)] z-30 w-40 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] py-1 shadow-[var(--shadow-md)]">
          {columns.map((c) => {
            const visible = !hidden.includes(c.key);
            return (
              <button
                key={c.key}
                disabled={c.required}
                onClick={() => toggle(tableId, c.key)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1 text-left text-2xs hover:bg-[var(--row-hover)] disabled:opacity-40",
                  visible ? "text-[var(--fg)]" : "text-[var(--fg-muted)]"
                )}
              >
                <span>{c.label}</span>
                {(visible || c.required) && <Check size={12} className="text-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
