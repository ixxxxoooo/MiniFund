import { cn } from "@/lib/utils";
import { formatPercent, quoteDirection } from "@/lib/format";

interface QuoteTextProps {
  /** 涨跌幅数值（如 1.24 表示 +1.24%） */
  value: number;
  /** 自定义展示文本（默认按百分比格式化） */
  text?: string;
  /** 摸鱼模式：中性配色、不带符号 */
  neutral?: boolean;
  className?: string;
}

/**
 * 涨跌文本统一出口组件。
 * 规范要求（docs/UI_GUIDELINES.md 4.2）：所有涨跌幅展示必须使用本组件，
 * 颜色只能来自 --quote-up / --quote-down / --quote-flat token。
 */
export function QuoteText({ value, text, neutral = false, className }: QuoteTextProps) {
  const direction = quoteDirection(value);
  // neutral 模式下：有自定义 text 时优先使用（如已脱敏的 "****"），
  // 无 text 时才退化为无符号百分比展示，避免金额值被误格式化为百分比。
  const display = neutral
    ? (text ?? `${Math.abs(value).toFixed(2)}%`)
    : (text ?? formatPercent(value));

  return (
    <span
      className={cn(
        "quote-num",
        neutral
          ? "text-[var(--quote-flat)]"
          : {
              "text-[var(--quote-up)]": direction === "up",
              "text-[var(--quote-down)]": direction === "down",
              "text-[var(--quote-flat)]": direction === "flat",
            },
        className
      )}
    >
      {display}
    </span>
  );
}
