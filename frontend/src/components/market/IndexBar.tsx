import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { quoteDirection } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QuoteText } from "./QuoteText";

/** 指数点位着色：随涨跌方向与涨跌幅同色；摸鱼模式统一中性色。 */
function priceColorClass(changePercent: number, stealth: boolean): string {
  if (stealth) return "text-[var(--quote-flat)]";
  const dir = quoteDirection(changePercent);
  if (dir === "up") return "text-[var(--quote-up)]";
  if (dir === "down") return "text-[var(--quote-down)]";
  return "text-[var(--quote-flat)]";
}

/**
 * 指数行情条：展示在主窗口标题栏中间，数据来自 market store（事件驱动）。
 * 注：大盘涨跌分布仅在托盘监控面板中展示，标题栏不再附带。
 */
export function IndexBar() {
  const indexes = useMarketStore((s) => s.indexes);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  return (
    // 标题栏空间有限：展示全部已选指数，超出部分横向滚动（隐藏滚动条），避免被裁剪后「看不到」
    <div className="titlebar-no-drag scroll-none flex min-w-0 items-center justify-end gap-[var(--size-padding)] overflow-x-auto">
      {indexes.map((q) => (
        <div key={q.symbol} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs">
          <span className="text-[var(--fg-secondary)]">{q.name}</span>
          <span className={cn("quote-num", priceColorClass(q.changePercent, stealth))}>{q.price.toFixed(2)}</span>
          <QuoteText value={q.changePercent} neutral={stealth} />
        </div>
      ))}
    </div>
  );
}
