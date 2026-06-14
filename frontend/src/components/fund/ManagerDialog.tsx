import { Star, User, Briefcase, TrendingUp } from "lucide-react";
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
      <DialogContent className="w-[440px] p-0">
        <DialogTitle className="sr-only">{zhCN.manager.title}</DialogTitle>

        {/* 头部：素色头部，与全局扁平风格统一 */}
        <div className="flex items-center gap-3.5 rounded-t-[var(--radius-panel)] border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-5 pb-4 pt-5">
          {m.pic ? (
            <img
              src={m.pic}
              alt={m.name}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-[var(--border-subtle)]"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] ring-1 ring-[var(--border-subtle)]">
              <User size={24} className="text-[var(--fg-muted)]" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--size-font-lg)] font-semibold text-[var(--fg)]">{m.name}</span>
              {m.star > 0 && (
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: m.star }).map((_, i) => (
                    <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                  ))}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {m.workTime && (
                <span className="flex items-center gap-1 text-2xs text-[var(--fg-secondary)]">
                  <Briefcase size={11} strokeWidth={2.5} className="text-[var(--fg-muted)]" />
                  {zhCN.manager.tenure} {m.workTime}
                </span>
              )}
              {m.fundSize && (
                <span className="flex items-center gap-1 text-2xs text-[var(--fg-secondary)]">
                  <TrendingUp size={11} strokeWidth={2.5} className="text-[var(--fg-muted)]" />
                  {zhCN.manager.fundSize} {m.fundSize}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
          {/* 能力评分（横向条形） */}
          {(m.powerCategories?.length ?? 0) > 0 && (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded-full bg-[var(--accent)]" />
                  <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                    {zhCN.manager.powerTitle}
                  </span>
                </div>
                {m.powerAvr && (
                  <span className="quote-num text-2xs text-[var(--fg-secondary)]">
                    {zhCN.manager.powerAvg}{" "}
                    <span className="font-medium text-[var(--fg)]">{m.powerAvr}</span>
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {m.powerCategories.map((cat, i) => {
                  const v = m.powerData?.[i] ?? 0;
                  const percent = Math.min(100, (v / maxPower) * 100);
                  return (
                    <div key={cat} className="flex items-center gap-2.5">
                      <span className="w-14 shrink-0 truncate text-2xs text-[var(--fg-secondary)]">{cat}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_70%,#8b5cf6)] transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="quote-num w-10 shrink-0 text-right text-2xs font-medium text-[var(--fg)]">
                        {v.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 分隔线 */}
          {(m.powerCategories?.length ?? 0) > 0 && (m.profitCategories?.length ?? 0) > 0 && (m.profitData?.length ?? 0) > 0 && (
            <div className="h-px bg-[var(--border-subtle)]" />
          )}

          {/* 任期收益对比（横向条形，正负着色） */}
          {(m.profitCategories?.length ?? 0) > 0 && (m.profitData?.length ?? 0) > 0 && (
            <section>
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="h-3 w-0.5 rounded-full bg-[var(--quote-up)]" />
                <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                  {zhCN.manager.profitTitle}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {m.profitCategories.map((cat, i) => {
                  const v = m.profitData?.[i];
                  if (v == null) return null;
                  const percent = (Math.abs(v) / maxProfit) * 100;
                  return (
                    <div key={cat} className="flex items-center gap-2.5">
                      <span className="w-14 shrink-0 truncate text-2xs text-[var(--fg-secondary)]">{cat}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            v >= 0
                              ? "bg-gradient-to-r from-[var(--quote-up)] to-[color-mix(in_srgb,var(--quote-up)_80%,#f97316)]"
                              : "bg-gradient-to-r from-[var(--quote-down)] to-[color-mix(in_srgb,var(--quote-down)_80%,#06b6d4)]"
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <QuoteText
                        value={v}
                        className="quote-num w-14 shrink-0 text-right text-2xs font-medium"
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
