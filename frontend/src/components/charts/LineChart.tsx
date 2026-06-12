import React, { useMemo, useRef, useState } from "react";

export interface LinePoint {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 数值 */
  value: number;
}

interface LineChartProps {
  points: LinePoint[];
  /** 图表高度（px） */
  height?: number;
  /** 数值格式化（tooltip 用） */
  formatValue?: (v: number) => string;
}

/**
 * 轻量 SVG 折线图：净值走势展示。
 * 不引入图表库，颜色全部来自主题 token；悬停显示十字线与数值。
 */
export function LineChart({ points, height = 220, formatValue }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640; // viewBox 逻辑宽度，实际渲染随容器伸缩

  const { path, areaPath, min, max, xAt, yAt } = useMemo(() => {
    if (points.length < 2) {
      return { path: "", areaPath: "", min: 0, max: 0, xAt: () => 0, yAt: () => 0 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    // 上下各留 6% 余量，避免曲线贴边
    const pad = (max - min || max * 0.01 || 1) * 0.06;
    min -= pad;
    max += pad;

    const xAt = (i: number) => (i / (points.length - 1)) * width;
    const yAt = (v: number) => height - ((v - min) / (max - min)) * height;

    let path = "";
    for (let i = 0; i < points.length; i++) {
      path += `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(points[i].value).toFixed(1)}`;
    }
    const areaPath = `${path}L${width},${height}L0,${height}Z`;
    return { path, areaPath, min, max, xAt, yAt };
  }, [points, height]);

  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]"
        style={{ height }}
      >
        暂无走势数据
      </div>
    );
  }

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hover = hoverIndex != null ? points[hoverIndex] : null;
  const fmt = formatValue ?? ((v: number) => v.toFixed(4));

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      {/* 悬停信息条 */}
      <div className="quote-num mb-1 flex h-4 items-center gap-3 text-2xs text-[var(--fg-secondary)]">
        {hover ? (
          <>
            <span>{hover.date}</span>
            <span className="text-[var(--fg)]">{fmt(hover.value)}</span>
          </>
        ) : (
          <>
            <span>高 {fmt(max)}</span>
            <span>低 {fmt(min)}</span>
          </>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
      >
        {/* 面积渐变填充 */}
        <defs>
          <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#chart-area)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hoverIndex != null && (
          <>
            <line
              x1={xAt(hoverIndex)}
              y1={0}
              x2={xAt(hoverIndex)}
              y2={height}
              stroke="var(--fg-muted)"
              strokeWidth="1"
              strokeDasharray="3,3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={xAt(hoverIndex)} cy={yAt(points[hoverIndex].value)} r="3" fill="var(--accent)" />
          </>
        )}
      </svg>
    </div>
  );
}
