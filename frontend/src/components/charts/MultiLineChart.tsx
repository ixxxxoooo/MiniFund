import React, { useMemo, useRef, useState } from "react";

export interface CompareSeries {
  /** 序列名称（基金名） */
  name: string;
  /** 曲线颜色 */
  color: string;
  /** 净值点（date 升序） */
  points: { date: string; value: number }[];
}

interface MultiLineChartProps {
  series: CompareSeries[];
  height?: number;
  /** 摸鱼模式：悬停数值去掉正负号前缀，避免在数值层面额外泄露涨跌方向（曲线形态本身无法脱敏） */
  stealth?: boolean;
}

/** 对比曲线备选颜色（第一条用主题强调色） */
export const COMPARE_COLORS = ["var(--accent)", "#e0a836", "#9d6ce8", "#36b3a8", "#e35d6a", "#5b8def"];

/**
 * 多序列归一化对比折线图：每条序列转为相对首日的收益率（%）曲线叠加展示。
 * 用于基金对比，X 轴按全部序列日期并集对齐。
 */
export function MultiLineChart({ series, height = 260, stealth = false }: MultiLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640;

  const { dates, lines, min, max } = useMemo(() => {
    // 日期并集（升序）
    const dateSet = new Set<string>();
    for (const s of series) {
      for (const p of s.points) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();
    if (dates.length < 2) {
      return { dates, lines: [], min: 0, max: 0 };
    }
    const dateIndex = new Map(dates.map((d, i) => [d, i]));

    let min = 0;
    let max = 0;
    // 每条序列归一化为收益率（%），并映射到全局日期索引
    const lines = series
      .filter((s) => s.points.length >= 2)
      .map((s) => {
        const base = s.points[0].value;
        const values: (number | null)[] = new Array(dates.length).fill(null);
        for (const p of s.points) {
          const pct = base > 0 ? ((p.value - base) / base) * 100 : 0;
          values[dateIndex.get(p.date)!] = pct;
          if (pct < min) min = pct;
          if (pct > max) max = pct;
        }
        return { name: s.name, color: s.color, values };
      });
    const pad = (max - min || 1) * 0.06;
    return { dates, lines, min: min - pad, max: max + pad };
  }, [series]);

  if (dates.length < 2 || lines.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]"
        style={{ height }}
      >
        暂无对比数据
      </div>
    );
  }

  const xAt = (i: number) => (i / (dates.length - 1)) * width;
  const yAt = (v: number) => height - ((v - min) / (max - min)) * height;
  const zeroY = yAt(0);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (dates.length - 1));
    setHoverIndex(Math.max(0, Math.min(dates.length - 1, idx)));
  };

  /** 取某序列在索引处的值（向前回退到最近有效点） */
  const valueAt = (values: (number | null)[], idx: number): number | null => {
    for (let i = idx; i >= 0; i--) {
      if (values[i] != null) return values[i];
    }
    return null;
  };

  const fmtLabel = (d: string) => {
    const m = /^\d{4}-(\d{2}-\d{2})$/.exec(d);
    return m ? m[1] : d;
  };
  const tickCount = Math.min(5, dates.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / Math.max(1, tickCount - 1)) * (dates.length - 1))
  );

  const hoverLeftPct = hoverIndex != null ? (xAt(hoverIndex) / width) * 100 : 0;
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
        <div className="quote-num mb-1 flex h-4 items-center text-2xs text-[var(--fg-secondary)]">
          <span>
            {fmtLabel(dates[0])} ~ {fmtLabel(dates[dates.length - 1])}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
          {/* 0% 基准线 */}
          <line
            x1={0}
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke="var(--border-color)"
            strokeWidth="1"
            strokeDasharray="4,4"
            vectorEffect="non-scaling-stroke"
          />
          {lines.map((l) => {
            let d = "";
            let started = false;
            for (let i = 0; i < l.values.length; i++) {
              const v = l.values[i];
              if (v == null) continue;
              d += `${started ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
              started = true;
            }
            return (
              <path key={l.name} d={d} fill="none" stroke={l.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            );
          })}
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
              {lines.map((l) => {
                const v = valueAt(l.values, hoverIndex);
                return v == null ? null : (
                  <circle key={l.name} cx={xAt(hoverIndex)} cy={yAt(v)} r="2.5" fill={l.color} />
                );
              })}
            </>
          )}
        </svg>

        {/* 悬停浮窗：日期 + 各序列收益率 */}
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
            <div className="mb-0.5 text-[var(--fg-secondary)]">{dates[hoverIndex]}</div>
            {lines.map((l) => {
              const v = valueAt(l.values, hoverIndex);
              return (
                <div key={l.name} className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
                  <span className="max-w-[120px] truncate text-[var(--fg-secondary)]">{l.name}</span>
                  <span className="quote-num ml-auto font-semibold text-[var(--fg)]">
                    {v != null ? `${!stealth && v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "--"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部时间刻度 */}
      <div className="quote-num mt-1 flex justify-between text-2xs text-[var(--fg-muted)]">
        {ticks.map((idx) => (
          <span key={idx}>{fmtLabel(dates[idx])}</span>
        ))}
      </div>
    </div>
  );
}
