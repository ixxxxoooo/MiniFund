import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/lib/sort";

interface SortableHeaderProps {
  /** 列标题 */
  label: string;
  /** 当前列是否为活动排序列 */
  active: boolean;
  /** 活动排序方向 */
  dir: SortDir;
  onClick: () => void;
  /** 对齐方式 */
  align?: "left" | "right" | "center";
  className?: string;
}

/**
 * 可排序表头单元格：点击循环 降序 → 升序 → 默认。
 * 所有表格列头排序必须使用本组件保证交互一致。
 */
export function SortableHeader({ label, active, dir, onClick, align = "right", className }: SortableHeaderProps) {
  return (
    <th
      className={cn(
        "data-grid-header cursor-pointer border-b hover:bg-[var(--row-hover)]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      onClick={onClick}
    >
      <span className={cn("inline-flex items-center gap-0.5", active && "text-[var(--accent)]")}>
        {label}
        {active && dir === "desc" && <ArrowDown size={10} />}
        {active && dir === "asc" && <ArrowUp size={10} />}
        {!active && <ArrowUpDown size={10} className="opacity-30" />}
      </span>
    </th>
  );
}
