import { useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import { QuoteText } from "@/components/market/QuoteText";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { formatMoney, formatPercent } from "@/lib/format";
import { computeGroupSummary } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { useMarketStore } from "@/stores/market";
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

/** 金额涨跌配色类（摸鱼模式中性色） */
function moneyColor(value: number, stealth: boolean): string {
  if (stealth) return "text-[var(--quote-flat)]";
  if (value > 0) return "text-[var(--quote-up)]";
  if (value < 0) return "text-[var(--quote-down)]";
  return "text-[var(--quote-flat)]";
}

/**
 * 持仓盈亏汇总卡片组：按「当前分组」统计当日预估收益 / 持仓市值 / 累计收益 / 持仓数。
 * 各分组互相隔离、各算各的；摸鱼模式或隐藏金额开关下做脱敏展示。
 */
export function ProfitCards() {
  const items = useWatchlistStore((s) => s.items);
  const positions = useWatchlistStore((s) => s.positions);
  const estimates = useMarketStore((s) => s.estimates);
  const hideAmounts = useUIStore((s) => s.hideAmounts);
  const toggleHide = useUIStore((s) => s.toggleHideAmounts);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  const hidden = hideAmounts || stealth;
  const summary = useMemo(
    () => computeGroupSummary(items, positions, estimates),
    [items, positions, estimates]
  );

  return (
    <div className="flex gap-[var(--size-gap)]">
      <Card
        label={zhCN.summary.todayProfit}
        extra={
          <Tooltip content={hideAmounts ? zhCN.summary.showAmounts : zhCN.summary.hideAmounts}>
            <button
              aria-label={hideAmounts ? zhCN.summary.showAmounts : zhCN.summary.hideAmounts}
              onClick={toggleHide}
              className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              {hideAmounts ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </Tooltip>
        }
      >
        <span className={cn(moneyColor(summary.todayProfit, stealth))}>
          {formatMoney(summary.todayProfit, hidden)}
        </span>
        <QuoteText
          value={summary.todayPercent}
          text={formatPercent(summary.todayPercent)}
          neutral={stealth}
          className="ml-2 text-[length:var(--size-font-xs)]"
        />
      </Card>
      <Card label={zhCN.summary.marketValue}>
        <span className="text-[var(--fg)]">{formatMoney(summary.marketValue, hidden)}</span>
      </Card>
      <Card label={zhCN.summary.totalProfit}>
        <span className={cn(moneyColor(summary.totalProfit, stealth))}>
          {formatMoney(summary.totalProfit, hidden)}
        </span>
        <QuoteText
          value={summary.totalPercent}
          text={formatPercent(summary.totalPercent)}
          neutral={stealth}
          className="ml-2 text-[length:var(--size-font-xs)]"
        />
      </Card>
      <Card label={zhCN.summary.positionCount}>
        <span className="text-[var(--fg)]">
          {summary.positionCount}
          <span className="ml-1 text-[length:var(--size-font-xs)] font-normal text-[var(--fg-secondary)]">
            {zhCN.summary.countUnit}
          </span>
        </span>
      </Card>
    </div>
  );
}
