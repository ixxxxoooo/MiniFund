import React, { useMemo, useRef, useState } from "react";

export interface LinePoint {
  /** 日期（YYYY-MM-DD）或时间（HH:mm） */
  date: string;
  /** 数值 */
  value: number;
}

/** 折线图上的买卖标记（位置对齐到对应净值点） */
export interface ChartMarker {
  /** 对应 points 的下标 */
  index: number;
  /** 买入 / 卖出 */
  kind: "buy" | "sell";
  /** 悬停提示（多行） */
  tip: string[];
}

interface LineChartProps {
  points: LinePoint[];
  /** 图表高度（px） */
  height?: number;
  /** 数值格式化（tooltip 用） */
  formatValue?: (v: number) => string;
  /** X 轴 / tooltip 标签格式化（默认原样展示） */
  formatLabel?: (d: string) => string;
  /** 买卖标记（如持仓交易点） */
  markers?: ChartMarker[];
}

/** 信息条高度补偿：叠加层相对容器定位，需抵消折线 svg 上方的高低信息条 */
const INFO_BAR_OFFSET = 16;

/** 默认坐标标签格式化：YYYY-MM-DD 压缩为 MM-DD，其余原样返回。 */
function defaultFormatLabel(d: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(d);
  return m ? m[1] : d;
}

/**
 * 轻量 SVG 折线图：净值走势展示。
 * 不引入图表库，颜色全部来自主题 token；悬停显示十字线、定位点与浮窗（时间 + 数值），底部带时间刻度。
 */
export function LineChart({ points, height = 220, formatValue, formatLabel, markers }: LineChartProps) {
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

  const fmt = formatValue ?? ((v: number) => v.toFixed(4));
  const fmtLabel = formatLabel ?? defaultFormatLabel;

  // 底部时间刻度：等距取 5 个
  const tickCount = Math.min(5, points.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / (tickCount - 1)) * (points.length - 1))
  );

  const hoverLeftPct = hoverIndex != null ? (xAt(hoverIndex) / width) * 100 : 0;
  // 浮窗水平翻转：靠右贴边时改为向左展开，避免被裁剪
  const tipTransform =
    hoverLeftPct > 72 ? "translate(-100%, -50%)" : hoverLeftPct < 16 ? "translate(0, -50%)" : "translate(-50%, -50%)";

  return (
    <div className="w-full select-none">
      <div
        ref={containerRef}
        className="relative w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* 非悬停时展示区间高低 */}
        <div className="quote-num mb-1 flex h-4 items-center gap-3 text-2xs text-[var(--fg-secondary)]">
          <span>高 {fmt(max)}</span>
          <span>低 {fmt(min)}</span>
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

        {/* 买卖标记叠加层：用 HTML 定位避免 SVG 横向拉伸导致图形变形 */}
        {markers?.map((m, i) => {
          if (m.index < 0 || m.index >= points.length) return null;
          const leftPct = (xAt(m.index) / width) * 100;
          const top = yAt(points[m.index].value) + INFO_BAR_OFFSET;
          const isBuy = m.kind === "buy";
          return (
            <div
              key={`${m.kind}-${m.index}-${i}`}
              className="quote-num pointer-events-auto absolute z-[5] flex h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-bold shadow-[var(--shadow-sm)]"
              style={{
                left: `${leftPct}%`,
                top,
                background: isBuy ? "var(--marker-buy)" : "var(--marker-sell)",
                color: isBuy ? "var(--marker-buy-fg)" : "var(--marker-sell-fg)",
              }}
              title={m.tip.join("\n")}
            >
              {isBuy ? "买" : "卖"}
            </div>
          );
        })}

        {/* 悬停浮窗：紧贴定位点显示时间 + 净值 */}
        {hoverIndex != null && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[var(--radius-sm)] border px-2 py-1 text-2xs shadow-[var(--shadow-md)]"
            style={{
              left: `${hoverLeftPct}%`,
              top: yAt(points[hoverIndex].value) + 16, // +16 抵消上方信息条高度
              transform: tipTransform,
              background: "var(--surface-elevated)",
              borderColor: "var(--border-color)",
            }}
          >
            <div className="text-[var(--fg-secondary)]">{fmtLabel(points[hoverIndex].date)}</div>
            <div className="quote-num font-semibold text-[var(--fg)]">{fmt(points[hoverIndex].value)}</div>
          </div>
        )}
      </div>

      {/* 底部时间刻度 */}
      <div className="quote-num mt-1 flex justify-between text-2xs text-[var(--fg-muted)]">
        {ticks.map((idx) => (
          <span key={idx}>{fmtLabel(points[idx].date)}</span>
        ))}
      </div>
    </div>
  );
}
