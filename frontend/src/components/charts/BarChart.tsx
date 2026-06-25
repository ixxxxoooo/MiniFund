import React, { useMemo, useRef, useState } from "react";

export interface BarPoint {
  /** 标签（日期） */
  label: string;
  /** 数值（正负均可） */
  value: number;
}

interface BarChartProps {
  points: BarPoint[];
  height?: number;
  /** 数值格式化（悬停提示用） */
  formatValue?: (v: number) => string;
  /** X 轴 / tooltip 标签格式化（默认压缩 YYYY-MM-DD 为 MM-DD） */
  formatLabel?: (d: string) => string;
  /** 摸鱼模式：柱体与悬停数值统一中性色，不按正负涨跌着色、不泄露方向 */
  stealth?: boolean;
}

/** 默认坐标标签格式化：YYYY-MM-DD 压缩为 MM-DD。 */
function defaultFormatLabel(d: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(d);
  return m ? m[1] : d;
}

/**
 * 正负柱状图：用于每日收益历史。正值用上涨色、负值用下跌色（跟随涨跌配色方案）。
 */
export function BarChart({ points, height = 180, formatValue, formatLabel, stealth = false }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640;

  const { max, zeroY } = useMemo(() => {
    let absMax = 0;
    for (const p of points) {
      const a = Math.abs(p.value);
      if (a > absMax) absMax = a;
    }
    if (absMax === 0) absMax = 1;
    // 正负对称布局，0 线居中
    return { max: absMax * 1.08, zeroY: height / 2 };
  }, [points, height]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]"
        style={{ height }}
      >
        暂无收益数据
      </div>
    );
  }

  const slot = width / points.length;
  const barW = Math.max(1.5, Math.min(14, slot * 0.65));

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const idx = Math.floor(((e.clientX - rect.left) / rect.width) * points.length);
    setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const fmt = formatValue ?? ((v: number) => v.toFixed(2));
  const fmtLabel = formatLabel ?? defaultFormatLabel;
  // 涨跌色：摸鱼模式下统一中性，柱体与数值都不按正负着色、不泄露方向。
  const barColor = (v: number) =>
    stealth ? "var(--fg-muted)" : v >= 0 ? "var(--quote-up)" : "var(--quote-down)";

  const tickCount = Math.min(5, points.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / Math.max(1, tickCount - 1)) * (points.length - 1))
  );

  const hoverLeftPct = hoverIndex != null ? ((hoverIndex + 0.5) * slot) / width * 100 : 0;
  const tipTransform =
    hoverLeftPct > 72 ? "translate(-100%, 0)" : hoverLeftPct < 16 ? "translate(0, 0)" : "translate(-50%, 0)";

  return (
    <div className="w-full select-none">
      <div
        ref={containerRef}
        className="relative w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <div className="quote-num mb-1 flex h-4 items-center gap-3 text-2xs text-[var(--fg-secondary)]">
          {points.length > 0 && (
            <span>
              {fmtLabel(points[0].label)} ~ {fmtLabel(points[points.length - 1].label)}
            </span>
          )}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
          <line
            x1={0}
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke="var(--border-color)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => {
            const h = (Math.abs(p.value) / max) * (height / 2);
            const x = i * slot + (slot - barW) / 2;
            const y = p.value >= 0 ? zeroY - h : zeroY;
            return (
              <rect
                key={p.label}
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0.5)}
                fill={barColor(p.value)}
                opacity={hoverIndex == null || hoverIndex === i ? 1 : 0.45}
              />
            );
          })}
        </svg>

        {/* 悬停浮窗：时间 + 当日收益 */}
        {hoverIndex != null && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[var(--radius-sm)] border px-2 py-1 text-2xs shadow-[var(--shadow-md)]"
            style={{
              left: `${hoverLeftPct}%`,
              top: 24,
              transform: tipTransform,
              background: "var(--surface-elevated)",
              borderColor: "var(--border-color)",
            }}
          >
            <div className="text-[var(--fg-secondary)]">{fmtLabel(points[hoverIndex].label)}</div>
            <div
              className="quote-num font-semibold"
              style={{ color: barColor(points[hoverIndex].value) }}
            >
              {fmt(points[hoverIndex].value)}
            </div>
          </div>
        )}
      </div>

      {/* 底部时间刻度 */}
      <div className="quote-num mt-1 flex justify-between text-2xs text-[var(--fg-muted)]">
        {ticks.map((idx) => (
          <span key={idx}>{fmtLabel(points[idx].label)}</span>
        ))}
      </div>
    </div>
  );
}
