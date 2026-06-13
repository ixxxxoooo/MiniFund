import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { zhCN } from "@/i18n/zh-CN";

interface ConfirmDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 标题 */
  title: string;
  /** 提示内容 */
  message: string;
  /** 确认按钮文案 */
  confirmLabel?: string;
  /** 是否为危险操作（确认按钮红色） */
  danger?: boolean;
  /** 点击确认 */
  onConfirm: () => void;
  /** 关闭/取消 */
  onCancel: () => void;
}

/**
 * 应用内确认弹窗：替代 window.confirm（Wails WebView 不支持原生 confirm，会直接返回 false 导致点击无效）。
 * 基于 Radix Dialog（Portal 渲染，不受表格 overflow 裁剪影响）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showClose={false} className="w-[360px]">
        <DialogTitle>{title}</DialogTitle>
        <p className="text-[length:var(--size-font-xs)] leading-relaxed text-[var(--fg-secondary)]">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {zhCN.common.cancel}
          </Button>
          <Button variant={danger ? "destructive" : "default"} size="sm" onClick={onConfirm}>
            {confirmLabel ?? zhCN.common.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
