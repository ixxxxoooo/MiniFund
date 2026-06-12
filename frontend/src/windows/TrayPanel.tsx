import { Settings } from "lucide-react";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { WindowService } from "@bindings/minifund/services";

/**
 * 托盘监控面板：点击托盘图标弹出的无边框置顶小窗（320x420）。
 * 当前为骨架占位，估值列表与盈亏数据接入见 docs/ROADMAP.md 里程碑 M3。
 */
export function TrayPanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--surface)] p-[var(--size-padding)]">
      {/* 当日盈亏汇总卡片 */}
      <div className="rounded-[var(--radius-panel)] bg-[var(--surface-secondary)] p-[var(--size-padding)]">
        <div className="text-2xs text-[var(--fg-muted)]">{zhCN.tray.todayProfit}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="quote-num text-xl font-semibold text-[var(--fg)]">¥ --</span>
          <QuoteText value={0} className="text-[length:var(--size-font-xs)]" />
        </div>
      </div>

      {/* 自选估值列表占位 */}
      <div className="scroll-always mt-[var(--size-gap)] flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        <span className="text-2xs text-[var(--fg-muted)]">{zhCN.main.watchlistEmpty}</span>
      </div>

      {/* 底部操作区 */}
      <div className="mt-[var(--size-gap)] flex shrink-0 items-center justify-between">
        <button
          className="rounded-[var(--radius-btn)] px-2 py-1 text-[length:var(--size-font-2xs)] text-[var(--accent)] hover:bg-[var(--sidebar-hover)]"
          onClick={() => void WindowService.ShowMainWindow()}
        >
          {zhCN.tray.openMain}
        </button>
        <button
          aria-label="设置"
          className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--sidebar-hover)]"
          onClick={() => void WindowService.ShowMainWindow()}
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
