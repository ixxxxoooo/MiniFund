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
 * 指数行情条：展示在主窗口标题栏右侧，数据来自 market store（事件驱动）。
 * 靠右展示，选多时向左扩展；空白区域保持可拖拽。
 * 使用 direction:rtl + overflow-hidden 规避 WebKit justify-end+overflow 的已知 bug。
 * @author ygw
 */
export function IndexBar() {
  const indexes = useMarketStore((s) => s.indexes);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);

  return (
    <div className="flex min-w-0 flex-1 items-center overflow-hidden" style={{ direction: "rtl" }}>
      <div className="flex shrink-0 items-center gap-[var(--size-padding)]" style={{ direction: "ltr" }}>
        {indexes.map((q) => (
          <div key={q.symbol} className="titlebar-no-drag flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs">
            <span className="text-[var(--fg-secondary)]">{q.name}</span>
            <span className={cn("quote-num", priceColorClass(q.changePercent, stealth))}>{q.price.toFixed(2)}</span>
            <QuoteText value={q.changePercent} neutral={stealth} />
          </div>
        ))}
      </div>
    </div>
  );
}
