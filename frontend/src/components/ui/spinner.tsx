import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpinnerProps {
  /** 图标尺寸（px） */
  size?: number;
  /** 加载文案（可选） */
  label?: string;
  className?: string;
}

/**
 * 统一加载动画：旋转图标 + 可选文案，颜色取自主题强调色。
 */
export function Spinner({ size = 18, label, className }: SpinnerProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-[var(--fg-muted)]", className)}>
      <Loader2 size={size} className="animate-spin text-[var(--accent)]" />
      {label && <span className="text-[length:var(--size-font-xs)]">{label}</span>}
    </div>
  );
}
