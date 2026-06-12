import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/** 应用级 Provider：在每个窗口根组件外包裹一次 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

interface TooltipProps {
  /** 提示文案 */
  content: React.ReactNode;
  /** 触发元素 */
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * 全局统一 Tooltip：深色浮层 + 主题 token，所有图标按钮必须使用本组件替代原生 title。
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[60] rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--surface-elevated)]",
            "px-2 py-1 text-2xs text-[var(--fg)] shadow-[var(--shadow-md)] animate-fade-in select-none",
            className
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--surface-elevated)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
