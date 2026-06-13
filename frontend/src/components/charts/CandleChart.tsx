import { useEffect, useMemo, useRef, useState } from "react";
import type { Kline } from "@bindings/minifund/internal/model";
import { quoteDirection } from "@/lib/format";

interface CandleChartProps {
  data: Kline[];
  /** 图表总高度（含量能区与日期轴），默认 380 */
  height?: number;
}

/** 计算收盘价的简单移动平均（不足窗口长度的点返回 null）。 */
function movingAverage(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** 量能/成交量友好格式化（手 → 亿手/万手）。 */
function formatVolume(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

/** 涨跌色 token：依 A 股惯例，涨用 --quote-up（红），跌用 --quote-down（绿）。 */
function candleColor(open: number, close: number): string {
  const dir = quoteDirection(close - open);
  if (dir === "up") return "var(--quote-up)";
  if (dir === "down") return "var(--quote-down)";
  return "var(--quote-flat)";
}

/**
 * 自研 SVG 蜡烛图（K 线）：蜡烛实体 + 影线 + 量能柱 + MA5/MA10/MA20 均线 + 十字光标浮窗。
 * 不引入图表库，颜色全部来自主题 token；宽度随容器自适应（ResizeObserver 实测像素，保证蜡烛清晰）。
 */
export function CandleChart({ data, height = 380 }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 布局：价格区 + 间隙 + 量能区 + 日期轴
  const dateAxisH = 18;
  const volH = 56;
  const gap = 10;
  const top = 6;
  const priceH = Math.max(80, height - dateAxisH - volH - gap - top);
  const volTop = top + priceH + gap;

  const geo = useMemo(() => {
    const n = data.length;
    if (n === 0) return null;
    let pMin = Infinity;
    let pMax = -Infinity;
    let vMax = 0;
    for (const k of data) {
      if (k.low < pMin) pMin = k.low;
      if (k.high > pMax) pMax = k.high;
      if (k.volume > vMax) vMax = k.volume;
    }
    const pad = (pMax - pMin || pMax * 0.01 || 1) * 0.05;
    pMin -= pad;
    pMax += pad;

    const step = width / n;
    const bodyW = Math.max(1, Math.min(step * 0.66, 16));
    const xAt = (i: number) => step * (i + 0.5);
    const yPrice = (v: number) => top + (1 - (v - pMin) / (pMax - pMin || 1)) * priceH;
    const yVol = (v: number) => volTop + volH - (v / (vMax || 1)) * volH;

    const closes = data.map((k) => k.close);
    const ma5 = movingAverage(closes, 5);
    const ma10 = movingAverage(closes, 10);
    const ma20 = movingAverage(closes, 20);
    const maPath = (ma: (number | null)[]): string => {
      let d = "";
      let started = false;
      for (let i = 0; i < ma.length; i++) {
        const v = ma[i];
        if (v == null) continue;
        d += `${started ? "L" : "M"}${xAt(i).toFixed(1)},${yPrice(v).toFixed(1)}`;
        started = true;
      }
      return d;
    };

    return { n, pMin, pMax, vMax, step, bodyW, xAt, yPrice, yVol, ma5Path: maPath(ma5), ma10Path: maPath(ma10), ma20Path: maPath(ma20) };
  }, [data, width, priceH, top, volTop, volH]);

  if (!geo || data.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]"
        style={{ height }}
      >
        暂无 K 线数据
      </div>
    );
  }

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const idx = Math.floor(x / geo.step);
    setHoverIndex(Math.max(0, Math.min(data.length - 1, idx)));
  };

  // 价格轴网格（4 等分）
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = geo.pMax - (i / gridCount) * (geo.pMax - geo.pMin);
    return { y: top + (i / gridCount) * priceH, value: v };
  });

  // 日期刻度：等距取 5 个
  const tickCount = Math.min(5, data.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / Math.max(1, tickCount - 1)) * (data.length - 1))
  );

  const hover = hoverIndex != null ? data[hoverIndex] : null;
  const hoverLeftPct = hoverIndex != null ? (geo.xAt(hoverIndex) / width) * 100 : 0;
  const tipTransform = hoverLeftPct > 64 ? "translateX(-100%)" : "translateX(0)";

  return (
    <div className="w-full select-none">
      {/* 均线图例 */}
      <div className="quote-num mb-1 flex items-center gap-3 text-2xs text-[var(--fg-secondary)]">
        <span className="text-[var(--accent)]">MA5</span>
        <span className="text-[var(--warning)]">MA10</span>
        <span className="text-[var(--info)]">MA20</span>
      </div>
      <div
        ref={containerRef}
        className="relative w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block">
          {/* 价格网格 + 右侧刻度 */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={0} y1={g.y} x2={width} y2={g.y} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="2,3" />
              <text x={width - 2} y={g.y - 2} textAnchor="end" className="quote-num" fontSize="9" fill="var(--fg-muted)">
                {g.value.toFixed(2)}
              </text>
            </g>
          ))}

          {/* 均线 */}
          <path d={geo.ma20Path} fill="none" stroke="var(--info)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={geo.ma10Path} fill="none" stroke="var(--warning)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={geo.ma5Path} fill="none" stroke="var(--accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* 蜡烛 + 量能柱 */}
          {data.map((k, i) => {
            const color = candleColor(k.open, k.close);
            const x = geo.xAt(i);
            const yOpen = geo.yPrice(k.open);
            const yClose = geo.yPrice(k.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yClose - yOpen));
            const volBarTop = geo.yVol(k.volume);
            const volBarH = Math.max(0.5, volTop + volH - volBarTop);
            return (
              <g key={i}>
                <line x1={x} y1={geo.yPrice(k.high)} x2={x} y2={geo.yPrice(k.low)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <rect x={x - geo.bodyW / 2} y={bodyTop} width={geo.bodyW} height={bodyH} fill={color} />
                <rect x={x - geo.bodyW / 2} y={volBarTop} width={geo.bodyW} height={volBarH} fill={color} opacity="0.7" />
              </g>
            );
          })}

          {/* 量能区分隔基线 */}
          <line x1={0} y1={volTop} x2={width} y2={volTop} stroke="var(--border-color)" strokeWidth="0.5" />

          {/* 十字光标 */}
          {hoverIndex != null && (
            <>
              <line x1={geo.xAt(hoverIndex)} y1={top} x2={geo.xAt(hoverIndex)} y2={volTop + volH} stroke="var(--fg-muted)" strokeWidth="0.5" strokeDasharray="3,3" />
            </>
          )}
        </svg>

        {/* 悬停浮窗：日期 + OHLC + 涨跌幅 + 量 */}
        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-[var(--radius-sm)] border px-2 py-1 text-2xs shadow-[var(--shadow-md)]"
            style={{
              left: `${hoverLeftPct}%`,
              transform: tipTransform,
              background: "var(--surface-elevated)",
              borderColor: "var(--border-color)",
            }}
          >
            <div className="mb-0.5 text-[var(--fg-secondary)]">{hover.date}</div>
            <div className="quote-num grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--fg)]">
              <span>开 {hover.open.toFixed(2)}</span>
              <span>高 {hover.high.toFixed(2)}</span>
              <span>收 {hover.close.toFixed(2)}</span>
              <span>低 {hover.low.toFixed(2)}</span>
              <span
                className={
                  quoteDirection(hover.changePercent) === "up"
                    ? "text-[var(--quote-up)]"
                    : quoteDirection(hover.changePercent) === "down"
                      ? "text-[var(--quote-down)]"
                      : "text-[var(--quote-flat)]"
                }
              >
                涨幅 {hover.changePercent > 0 ? "+" : ""}{hover.changePercent.toFixed(2)}%
              </span>
              <span className="text-[var(--fg-secondary)]">量 {formatVolume(hover.volume)}</span>
            </div>
          </div>
        )}
      </div>

      {/* 日期刻度 */}
      <div className="quote-num mt-1 flex justify-between text-2xs text-[var(--fg-muted)]">
        {ticks.map((idx) => (
          <span key={idx}>{data[idx]?.date.slice(5)}</span>
        ))}
      </div>
    </div>
  );
}
