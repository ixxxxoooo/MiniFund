import { Eye, EyeOff } from "lucide-react";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

/** 单张汇总卡片 */
function Card({ label, children, extra }: { label: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] py-[var(--size-padding-sm)]">
      <div className="flex items-center justify-between text-2xs text-[var(--fg-secondary)]">
        <span>{label}</span>
        {extra}
      </div>
      <div className="quote-num truncate text-[length:var(--size-font-base)] font-semibold">{children}</div>
    </div>
  );
}

/**
 * 持仓盈亏汇总卡片组：当日预估收益 / 持仓市值 / 累计收益 / 持仓数。
 * 摸鱼模式或隐藏金额开关下做脱敏展示。
 */
export function ProfitCards() {
  const summary = useWatchlistStore((s) => s.summary);
  const hideAmounts = useUIStore((s) => s.hideAmounts);
  const toggleHide = useUIStore((s) => s.toggleHideAmounts);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  const hidden = hideAmounts || stealth;
  const todayProfit = summary?.todayProfit ?? 0;
  const todayPercent = summary?.todayPercent ?? 0;

  return (
    <div className="flex gap-[var(--size-gap)]">
      <Card
        label={zhCN.summary.todayProfit}
        extra={
          <button
            aria-label={hideAmounts ? zhCN.summary.showAmounts : zhCN.summary.hideAmounts}
            onClick={toggleHide}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {hideAmounts ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        }
      >
        <span
          className={cn(
            stealth
              ? "text-[var(--quote-flat)]"
              : todayProfit > 0
                ? "text-[var(--quote-up)]"
                : todayProfit < 0
                  ? "text-[var(--quote-down)]"
                  : "text-[var(--quote-flat)]"
          )}
        >
          {formatMoney(todayProfit, hidden)}
        </span>
        <QuoteText value={todayPercent} text={formatPercent(todayPercent)} neutral={stealth} className="ml-2 text-[length:var(--size-font-xs)]" />
      </Card>
      <Card label={zhCN.summary.marketValue}>
        <span className="text-[var(--fg)]">{formatMoney(summary?.marketValue ?? 0, hidden)}</span>
      </Card>
      <Card label={zhCN.summary.totalProfit}>
        <span
          className={cn(
            stealth
              ? "text-[var(--quote-flat)]"
              : (summary?.totalProfit ?? 0) > 0
                ? "text-[var(--quote-up)]"
                : (summary?.totalProfit ?? 0) < 0
                  ? "text-[var(--quote-down)]"
                  : "text-[var(--quote-flat)]"
          )}
        >
          {formatMoney(summary?.totalProfit ?? 0, hidden)}
        </span>
      </Card>
      <Card label={zhCN.summary.positionCount}>
        <span className="text-[var(--fg)]">
          {summary?.positionCount ?? 0}
          <span className="ml-1 text-[length:var(--size-font-xs)] font-normal text-[var(--fg-secondary)]">
            {zhCN.summary.countUnit}
          </span>
        </span>
      </Card>
    </div>
  );
}
