import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SectorItem } from "@bindings/minifund/internal/model";
import { MarketService } from "@bindings/minifund/services";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";

type SectorKind = "industry" | "concept";

/**
 * 板块行情页：行业/概念板块卡片，按涨跌幅排序展示。
 */
export function SectorPage() {
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const [kind, setKind] = useState<SectorKind>("industry");
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadSectors = useCallback(async (k: SectorKind) => {
    setLoading(true);
    setFailed(false);
    const list = await call("加载板块行情", () => MarketService.GetSectors(k));
    setLoading(false);
    if (list) {
      setSectors(list);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadSectors(kind);
  }, [kind, loadSectors]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(["industry", "concept"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                k === kind
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.sectors[k]}
            </button>
          ))}
        </div>
        <button
          aria-label={zhCN.sectors.refresh}
          title={zhCN.sectors.refresh}
          onClick={() => void loadSectors(kind)}
          disabled={loading}
          className="rounded-[var(--radius-btn)] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)] disabled:opacity-40"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      <div className="scroll-always min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
            {zhCN.sectors.loadFailed}
          </div>
        ) : (
          <div className={cn("grid grid-cols-3 gap-[var(--size-gap)] xl:grid-cols-4", loading && "opacity-50")}>
            {sectors.map((s) => (
              <div
                key={s.code}
                className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--size-padding)] py-[var(--size-padding-sm)]"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
                    {s.name}
                  </span>
                  <QuoteText
                    value={s.changePercent}
                    neutral={stealth}
                    className="text-[length:var(--size-font-sm)] font-semibold"
                  />
                </div>
                <div className="flex items-center justify-between text-2xs text-[var(--fg-secondary)]">
                  <span className="quote-num">
                    {zhCN.sectors.upCount} {s.upCount} / {zhCN.sectors.downCount} {s.downCount}
                  </span>
                  <span className="truncate">
                    {zhCN.sectors.leadStock} {s.leadStock}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
