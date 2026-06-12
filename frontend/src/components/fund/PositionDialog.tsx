import { useEffect, useState } from "react";
import type { WatchItem } from "@bindings/minifund/internal/model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { zhCN } from "@/i18n/zh-CN";
import { useWatchlistStore } from "@/stores/watchlist";

interface PositionDialogProps {
  /** 正在编辑持仓的自选条目，null 表示关闭 */
  item: WatchItem | null;
  onClose: () => void;
}

/** 持仓编辑对话框：录入份额与成本价，计算口径见 docs/PRD.md 2.3。 */
export function PositionDialog({ item, onClose }: PositionDialogProps) {
  const positions = useWatchlistStore((s) => s.positions);
  const savePosition = useWatchlistStore((s) => s.savePosition);
  const deletePosition = useWatchlistStore((s) => s.deletePosition);

  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");

  const existing = item ? positions[item.code] : undefined;

  // 打开时回填已有持仓
  useEffect(() => {
    if (item) {
      setShares(existing ? String(existing.shares) : "");
      setCost(existing ? String(existing.costPrice) : "");
      setError("");
    }
  }, [item, existing]);

  const handleSave = async () => {
    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(cost);
    if (!item || !(sharesNum > 0) || !(costNum > 0)) {
      setError(zhCN.position.invalid);
      return;
    }
    await savePosition(item.code, sharesNum, costNum);
    onClose();
  };

  const handleDelete = async () => {
    if (!item) return;
    await deletePosition(item.code);
    onClose();
  };

  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {zhCN.position.title}
          {item && (
            <span className="ml-2 text-[length:var(--size-font-xs)] font-normal text-[var(--fg-secondary)]">
              {item.name} <span className="quote-num">{item.code}</span>
            </span>
          )}
        </DialogTitle>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
            {zhCN.position.shares}
            <Input
              type="number"
              min="0"
              step="0.01"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder={zhCN.position.sharesPlaceholder}
            />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
            {zhCN.position.costPrice}
            <Input
              type="number"
              min="0"
              step="0.0001"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={zhCN.position.costPlaceholder}
            />
          </label>
          {error && <div className="text-2xs text-[var(--danger)]">{error}</div>}

          <div className="mt-1 flex items-center justify-between">
            {existing ? (
              <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => void handleDelete()}>
                {zhCN.position.delete}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {zhCN.position.cancel}
              </Button>
              <Button size="sm" onClick={() => void handleSave()}>
                {zhCN.position.save}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
