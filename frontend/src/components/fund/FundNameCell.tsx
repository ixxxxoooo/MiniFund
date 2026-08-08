import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FundService } from "@bindings/minifund/services";
import type { NavRecord } from "@bindings/minifund/internal/model";
import { QuoteText } from "@/components/market/QuoteText";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { formatNav } from "@/lib/format";

/**
 * 近 10 天净值缓存：避免重复请求，整个生命周期内有效。
 * key = 基金代码，value = NavRecord[] 或 null（加载失败）。
 * @author ygw
 */
const navCache = new Map<string, NavRecord[] | null>();

/** 浮窗尺寸常量 */
const POPUP_W = 280;
const POPUP_H = 340;
const CURSOR_OFFSET = 12;

/**
 * 基金名称单元格容器：鼠标悬浮到整个单元格区域时显示最近 10 天净值预览浮窗。
 * 浮窗紧贴鼠标右侧并跟随鼠标移动，根据屏幕空间自动调整展示方向。
 * @author ygw
 */
export function FundNameCell({
  code,
  name,
  children,
  className,
}: {
  /** 基金代码 */
  code: string;
  /** 基金名称（浮窗标题用） */
  name: string;
  /** 单元格内全部内容（名称行 + 代码行等） */
  children: React.ReactNode;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [records, setRecords] = useState<NavRecord[] | null | undefined>(undefined);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimer = useRef<number | undefined>(undefined);

  const handleEnter = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
    hoverTimer.current = window.setTimeout(() => {
      setHovered(true);
    }, 300);
  };

  const handleMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleLeave = () => {
    window.clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  useEffect(() => {
    if (!hovered) return;
    if (navCache.has(code)) {
      setRecords(navCache.get(code));
      return;
    }
    setRecords(undefined);
    let cancelled = false;
    void call("加载净值预览", () => FundService.GetNavHistory(code, 1, 10)).then((res) => {
      if (cancelled) return;
      const items = res?.items ?? null;
      navCache.set(code, items);
      setRecords(items);
    });
    return () => { cancelled = true; };
  }, [hovered, code]);

  return (
    <div
      className={cn("flex flex-col gap-0.5 py-0.5", className)}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {children}
      {hovered && createPortal(
        <NavPreviewPopup code={code} name={name} records={records} mouseX={mousePos.x} mouseY={mousePos.y} />,
        document.body
      )}
    </div>
  );
}

/**
 * 计算浮窗位置：紧贴鼠标，根据屏幕空间自动调整方向。
 * 优先右侧展示，空间不足则左侧；优先下方对齐，空间不足则上移。
 * @author ygw
 */
function calcPopupPos(mouseX: number, mouseY: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 水平方向：优先鼠标右侧，右侧放不下则左侧
  let left: number;
  if (mouseX + CURSOR_OFFSET + POPUP_W + 8 <= vw) {
    left = mouseX + CURSOR_OFFSET;
  } else {
    left = mouseX - CURSOR_OFFSET - POPUP_W;
  }
  left = Math.max(8, Math.min(left, vw - POPUP_W - 8));

  // 垂直方向：鼠标位置作为顶部起点，下方放不下则上移
  let top: number;
  if (mouseY + POPUP_H + 8 <= vh) {
    top = mouseY;
  } else {
    top = vh - POPUP_H - 8;
  }
  top = Math.max(8, top);

  return { left, top };
}

/**
 * 净值预览浮窗：表格形式展示近 10 天净值与涨跌幅。
 * 顶部显示基金名称和代码，下方为三列表格（日期/单位净值/涨跌幅）。
 * @author ygw
 */
function NavPreviewPopup({
  code,
  name,
  records,
  mouseX,
  mouseY,
}: {
  code: string;
  name: string;
  records: NavRecord[] | null | undefined;
  mouseX: number;
  mouseY: number;
}) {
  const { left, top } = calcPopupPos(mouseX, mouseY);

  return (
    <div
      className="pointer-events-none fixed z-[200] w-[280px] rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] shadow-[var(--shadow-lg)] animate-fade-in"
      style={{ left, top }}
    >
      {/* 浮窗头部：基金名称 + 代码 */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <span className="min-w-0 truncate text-xs font-medium text-[var(--fg)]">{name}</span>
        <span className="shrink-0 text-2xs text-[var(--fg-muted)]">{code}</span>
      </div>

      {/* 表格区域 */}
      <div className="px-1 py-1">
        {records === undefined && (
          <div className="flex items-center justify-center py-6 text-2xs text-[var(--fg-muted)]">加载中...</div>
        )}
        {(records === null || (records && records.length === 0)) && (
          <div className="flex items-center justify-center py-6 text-2xs text-[var(--fg-muted)]">暂无净值数据</div>
        )}
        {records && records.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-2xs text-[var(--fg-muted)]">
                <th className="px-2 py-1 text-left font-normal">日期</th>
                <th className="px-2 py-1 text-right font-normal">单位净值</th>
                <th className="px-2 py-1 text-right font-normal">涨跌幅</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={r.date}
                  className={cn(
                    "text-2xs",
                    i % 2 === 0 ? "bg-[var(--surface-secondary)]/40" : ""
                  )}
                >
                  <td className="px-2 py-[3px] text-left text-[var(--fg-secondary)]">{r.date}</td>
                  <td className="px-2 py-[3px] text-right">
                    <span className="quote-num text-[var(--fg)]">{formatNav(r.nav)}</span>
                  </td>
                  <td className="px-2 py-[3px] text-right">
                    <QuoteText value={r.growth} className="text-2xs" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
