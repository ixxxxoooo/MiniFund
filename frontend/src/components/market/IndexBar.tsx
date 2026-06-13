import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { QuoteText } from "./QuoteText";

/**
 * 指数行情条：展示在主窗口标题栏中间，数据来自 market store（事件驱动）。
 * 注：大盘涨跌分布仅在托盘监控面板中展示，标题栏不再附带。
 */
export function IndexBar() {
  const indexes = useMarketStore((s) => s.indexes);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  return (
    <div className="titlebar-no-drag flex items-center gap-[var(--size-padding)] overflow-hidden">
      {indexes.slice(0, 5).map((q) => (
        <div key={q.symbol} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs">
          <span className="text-[var(--fg-secondary)]">{q.name}</span>
          <span className="quote-num text-[var(--fg)]">{q.price.toFixed(2)}</span>
          <QuoteText value={q.changePercent} neutral={stealth} />
        </div>
      ))}
    </div>
  );
}
