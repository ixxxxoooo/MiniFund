import { useMemo } from "react";
import type { MarketBreadth } from "@bindings/minifund/internal/model";
import { cn } from "@/lib/utils";

interface BreadthChartProps {
  breadth: MarketBreadth;
  /** 紧凑模式（托盘面板）：更矮的柱体与更小的标签 */
  compact?: boolean;
}

/** 档位聚合定义：业界涨跌分布图惯例的 11 档（跌停 → 涨停） */
const BUCKETS: { label: string; levels: number[]; dir: "down" | "flat" | "up" }[] = [
  { label: "跌停", levels: [-11], dir: "down" },
  { label: ">7", levels: [-10, -9, -8], dir: "down" },
  { label: "7-5", levels: [-7, -6], dir: "down" },
  { label: "5-3", levels: [-5, -4], dir: "down" },
  { label: "3-0", levels: [-3, -2, -1], dir: "down" },
  { label: "平", levels: [0], dir: "flat" },
  { label: "0-3", levels: [1, 2, 3], dir: "up" },
  { label: "3-5", levels: [4, 5], dir: "up" },
  { label: "5-7", levels: [6, 7], dir: "up" },
  { label: ">7", levels: [8, 9, 10], dir: "up" },
  { label: "涨停", levels: [11], dir: "up" },
];

/**
 * 大盘涨跌分布图：按涨跌幅档位统计的家数柱状图（参考东财/同花顺涨跌分布）。
 * 下跌档用下跌色、上涨档用上涨色，颜色跟随涨跌配色方案。
 */
export function BreadthChart({ breadth, compact = false }: BreadthChartProps) {
  const buckets = useMemo(() => {
    const byLevel = new Map(breadth.bins.map((b) => [b.level, b.count]));
    const rows = BUCKETS.map((b) => ({
      ...b,
      count: b.levels.reduce((sum, lv) => sum + (byLevel.get(lv) ?? 0), 0),
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => ({ ...r, ratio: r.count / max }));
  }, [breadth]);

  const barArea = compact ? 52 : 96;
  // 预留柱顶家数文字高度，柱体按剩余空间换算像素高度，保证数字不溢出容器
  const labelH = compact ? 11 : 14;

  return (
    <div className="flex w-full flex-col gap-1">
      {/* 汇总行：上涨 / 平 / 下跌家数 */}
      <div
        className={cn(
          "quote-num flex items-center justify-between whitespace-nowrap",
          compact ? "text-2xs" : "text-[length:var(--size-font-xs)]"
        )}
      >
        <span className="text-[var(--quote-down)]">跌 {breadth.downCount}</span>
        <span className="text-[var(--fg-muted)]">平 {breadth.flatCount}</span>
        <span className="text-[var(--quote-up)]">涨 {breadth.upCount}</span>
      </div>
      {/* 分布柱体（家数常显在柱顶，便于核对数据） */}
      <div className="flex items-end gap-[3px]" style={{ height: barArea }}>
        {buckets.map((b, i) => (
          <div key={i} className="relative flex h-full flex-1 flex-col items-center justify-end">
            <span
              className={cn(
                "quote-num pointer-events-none mb-0.5 leading-none",
                compact ? "text-[9px]" : "text-2xs",
                b.dir === "up" ? "text-[var(--quote-up)]" : b.dir === "down" ? "text-[var(--quote-down)]" : "text-[var(--fg-muted)]"
              )}
            >
              {b.count}
            </span>
            <div
              className="w-full rounded-t-[2px]"
              style={{
                height: Math.max(b.ratio * (barArea - labelH), 2),
                background:
                  b.dir === "up" ? "var(--quote-up)" : b.dir === "down" ? "var(--quote-down)" : "var(--fg-muted)",
                opacity: b.dir === "flat" ? 0.5 : 0.9,
              }}
            />
          </div>
        ))}
      </div>
      {/* 档位标签 */}
      <div className="flex gap-[3px]">
        {buckets.map((b, i) => (
          <span
            key={i}
            className="flex-1 whitespace-nowrap text-center text-[9px] leading-none text-[var(--fg-muted)]"
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
