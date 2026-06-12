import { Star, User } from "lucide-react";
import type { ManagerInfo } from "@bindings/minifund/internal/model";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { cn } from "@/lib/utils";

interface ManagerDialogProps {
  manager: ManagerInfo | null;
  onClose: () => void;
}

/**
 * 基金经理档案弹窗：照片、星级、任职年限、管理规模、能力评分、任期收益对比。
 */
export function ManagerDialog({ manager, onClose }: ManagerDialogProps) {
  if (!manager) return null;
  const m = manager;
  const maxPower = 100;
  const maxProfit = Math.max(1, ...(m.profitData ?? []).map((v) => Math.abs(v)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[420px]">
        <DialogTitle>{zhCN.manager.title}</DialogTitle>

        {/* 基本信息 */}
        <div className="mt-3 flex items-center gap-3">
          {m.pic ? (
            <img src={m.pic} alt={m.name} className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-secondary)] text-[var(--fg-muted)]">
              <User size={22} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--size-font-base)] font-semibold text-[var(--fg)]">{m.name}</span>
              {m.star > 0 && (
                <span className="flex items-center">
                  {Array.from({ length: m.star }).map((_, i) => (
                    <Star key={i} size={11} className="fill-[#e0a836] text-[#e0a836]" />
                  ))}
                </span>
              )}
            </div>
            <span className="truncate text-2xs text-[var(--fg-secondary)]">
              {zhCN.manager.tenure} {m.workTime}
            </span>
            {m.fundSize && (
              <span className="truncate text-2xs text-[var(--fg-secondary)]">
                {zhCN.manager.fundSize} {m.fundSize}
              </span>
            )}
          </div>
        </div>

        {/* 能力评分（横向条形） */}
        {(m.powerCategories?.length ?? 0) > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-2xs">
              <span className="font-medium text-[var(--fg)]">{zhCN.manager.powerTitle}</span>
              {m.powerAvr && (
                <span className="quote-num text-[var(--fg-secondary)]">
                  {zhCN.manager.powerAvg} {m.powerAvr}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {m.powerCategories.map((cat, i) => {
                const v = m.powerData?.[i] ?? 0;
                return (
                  <div key={cat} className="flex items-center gap-2 text-2xs">
                    <span className="w-14 shrink-0 whitespace-nowrap text-[var(--fg-secondary)]">{cat}</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${Math.min(100, (v / maxPower) * 100)}%` }}
                      />
                    </div>
                    <span className="quote-num w-10 shrink-0 text-right text-[var(--fg)]">{v.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 任期收益对比（横向条形，正负着色） */}
        {(m.profitCategories?.length ?? 0) > 0 && (m.profitData?.length ?? 0) > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-2xs font-medium text-[var(--fg)]">{zhCN.manager.profitTitle}</div>
            <div className="flex flex-col gap-1">
              {m.profitCategories.map((cat, i) => {
                const v = m.profitData?.[i];
                if (v == null) return null;
                return (
                  <div key={cat} className="flex items-center gap-2 text-2xs">
                    <span className="w-14 shrink-0 whitespace-nowrap text-[var(--fg-secondary)]">{cat}</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                      <div
                        className={cn("h-full rounded-full", v >= 0 ? "bg-[var(--quote-up)]" : "bg-[var(--quote-down)]")}
                        style={{ width: `${(Math.abs(v) / maxProfit) * 100}%` }}
                      />
                    </div>
                    <QuoteText value={v} className="quote-num w-14 shrink-0 text-right" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
