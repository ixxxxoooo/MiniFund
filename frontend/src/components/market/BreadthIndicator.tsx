import { useEffect } from "react";
import { BreadthChart } from "@/components/charts/BreadthChart";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { useMarketStore } from "@/stores/market";

/**
 * 大盘涨跌分布指示器：标题栏常驻红绿比例条 + 涨跌家数，
 * 悬停展示完整分布柱状图；每 60s 自动刷新。
 */
export function BreadthIndicator() {
  const breadth = useMarketStore((s) => s.breadth);
  const loadBreadth = useMarketStore((s) => s.loadBreadth);

  useEffect(() => {
    void loadBreadth();
    const timer = window.setInterval(() => void loadBreadth(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadBreadth]);

  if (!breadth) return null;

  const total = breadth.upCount + breadth.downCount + breadth.flatCount;
  if (total === 0) return null;

  return (
    <Tooltip
      content={
        <div className="w-56 p-1">
          <div className="mb-1 text-2xs font-medium text-[var(--fg)]">{zhCN.breadth.title}</div>
          <BreadthChart breadth={breadth} compact />
        </div>
      }
      side="bottom"
    >
      <div className="titlebar-no-drag flex shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap text-2xs">
        <span className="quote-num text-[var(--quote-up)]">{breadth.upCount}</span>
        {/* 红绿比例条 */}
        <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
          <span className="h-full bg-[var(--quote-up)]" style={{ width: `${(breadth.upCount / total) * 100}%` }} />
          <span className="h-full bg-[var(--fg-muted)] opacity-50" style={{ width: `${(breadth.flatCount / total) * 100}%` }} />
          <span className="h-full bg-[var(--quote-down)]" style={{ width: `${(breadth.downCount / total) * 100}%` }} />
        </span>
        <span className="quote-num text-[var(--quote-down)]">{breadth.downCount}</span>
      </div>
    </Tooltip>
  );
}
