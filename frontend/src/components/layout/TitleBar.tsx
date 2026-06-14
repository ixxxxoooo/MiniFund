import React from "react";
import { cn } from "@/lib/utils";
import { WindowMinimise, WindowToggleMaximise } from "@/lib/wails/runtime";
import { WindowService } from "@bindings/minifund/services";

interface TitleBarProps {
  /** 标题栏中间区域内容（如搜索框、指数行情条） */
  children?: React.ReactNode;
  /** 关闭按钮行为：主窗口为隐藏到托盘 */
  onClose?: () => void;
  className?: string;
}

/** macOS 风格红绿灯按钮 */
function TrafficLight({
  color,
  onClick,
  label,
}: {
  color: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="window-control-btn titlebar-no-drag h-3 w-3 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Frameless 窗口自绘标题栏：拖拽区 + 红绿灯按钮。
 * 高度固定为 --size-toolbar，背景使用工具栏 token。
 */
export function TitleBar({ children, onClose, className }: TitleBarProps) {
  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    // 默认行为：隐藏主窗口到托盘，后台继续监控
    void WindowService.HideMainWindow();
  };

  return (
    <div
      // 双击标题栏拖拽区：最大化窗口，已最大化时还原（与 macOS 行为一致）。
      onDoubleClick={() => void WindowToggleMaximise()}
      className={cn(
        "titlebar-drag flex h-[var(--size-toolbar)] shrink-0 items-center gap-[var(--size-gap)] border-b px-[var(--size-padding)]",
        "border-[var(--toolbar-border)] bg-[var(--toolbar-bg)] vibrancy",
        className
      )}
    >
      {/* 红绿灯按钮：双击不应触发标题栏的最大化切换 */}
      <div className="flex items-center gap-2" onDoubleClick={(e) => e.stopPropagation()}>
        <TrafficLight color="#ff5f57" onClick={handleClose} label="关闭窗口" />
        <TrafficLight color="#febc2e" onClick={() => void WindowMinimise()} label="最小化" />
        <TrafficLight color="#28c840" onClick={() => void WindowToggleMaximise()} label="最大化" />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
      {/* 右侧占位，保证中间内容视觉居中 */}
      <div className="w-[52px]" />
    </div>
  );
}
