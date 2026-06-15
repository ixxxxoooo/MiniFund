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
    // 标题栏空间有限：指数从左侧（搜索框右边）依次排布，放不下的尾部直接裁掉隐藏。
    // 注意必须用 justify-start：WebKit(WKWebView) 下 justify-end + overflow 会让溢出内容从左侧漏出、遮挡搜索框。
    <div className="titlebar-no-drag flex min-w-0 flex-1 items-center justify-start gap-[var(--size-padding)] overflow-hidden">
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
