import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Radix Dialog 封装：遮罩 + 居中面板，样式遵循主题 token */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** 是否显示右上角关闭按钮 */
    showClose?: boolean;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2",
        "rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--surface-elevated)] shadow-[var(--shadow-lg)]",
        "p-[var(--size-padding)] animate-fade-in focus:outline-none",
        className
      )}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          aria-label="关闭"
          className="absolute right-3 top-3 rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)]"
        >
          <X size={14} />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("mb-3 text-[length:var(--size-font-sm)] font-semibold text-[var(--fg)]", className)}
      {...props}
    />
  );
}
