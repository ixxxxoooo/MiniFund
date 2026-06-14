import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { FundPerf, FundTheme } from "@bindings/minifund/internal/model";
import { FundService } from "@bindings/minifund/services";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useWatchlistStore } from "@/stores/watchlist";

/**
 * 基金列表共享辅助件：主题标签加载、彩色主题药丸、加自选按钮。
 * 由「基金排行」「搜索」等列表页共用，保证交互与配色一致。
 */

/**
 * 批量加载一组基金的所属主题（code → 主题列表），缺失项由后端拉取+缓存。
 * codes 变化时增量合并，已加载过的不会闪烁。
 */
export function useFundThemes(codes: string[]): Record<string, FundTheme[] | undefined> {
  const [map, setMap] = useState<Record<string, FundTheme[] | undefined>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (codes.length === 0) return;
    let cancelled = false;
    void call("加载基金主题", () => FundService.GetFundThemes(codes)).then((res) => {
      if (cancelled || !res) return;
      setMap((prev) => ({ ...prev, ...res }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/**
 * 批量补全一组基金的阶段收益（code → 收益：今日/近1周/近1月/近3月/近1年/今年来）。
 * codes 变化时增量合并；后端命中 3 分钟缓存，翻页几乎零等待。
 */
export function useFundPerformance(codes: string[]): Record<string, FundPerf | undefined> {
  const [map, setMap] = useState<Record<string, FundPerf | undefined>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (codes.length === 0) return;
    let cancelled = false;
    void call("加载基金收益", () => FundService.GetFundPerformance(codes)).then((res) => {
      if (cancelled || !res) return;
      setMap((prev) => ({ ...prev, ...res }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/** 标签分类配色票数量（与 globals.css 的 --chip-{n}-bg/fg 一一对应） */
const CHIP_PALETTE = 6;

/** 由标签名/代码哈希到稳定的配色索引，保证同一主题始终同色 */
function chipColorIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % CHIP_PALETTE;
}

/**
 * 基金所属主题标签：彩色药丸（按主题名稳定取色），最多展示 2 个，多余以 +N 折叠，hover 显示全部。
 * 配色取自 globals.css 的 --chip-* token（规避红/绿，避免与涨跌混淆）。
 */
export function ThemeChips({ themes, className }: { themes?: FundTheme[]; className?: string }) {
  if (!themes || themes.length === 0) return null;
  const shown = themes.slice(0, 2);
  const rest = themes.length - shown.length;
  return (
    <div
      className={cn("flex items-center gap-1 overflow-hidden", className)}
      title={themes.map((t) => t.name).join(" / ")}
    >
      {shown.map((t) => {
        const idx = chipColorIndex(t.code || t.name);
        return (
          <span
            key={t.code}
            className="shrink-0 truncate rounded-[var(--radius-sm)] px-1.5 py-px text-[10px] font-medium leading-tight"
            style={{
              backgroundColor: `var(--chip-${idx}-bg)`,
              color: `var(--chip-${idx}-fg)`,
            }}
          >
            {t.name}
          </span>
        );
      })}
      {rest > 0 && <span className="shrink-0 text-[10px] text-[var(--fg-muted)]">+{rest}</span>}
    </div>
  );
}

/** 加自选按钮：图标 + 「加自选」文字；已在自选中则展示「已添加」 */
export function AddButton({ code, onAdd }: { code: string; onAdd: () => void }) {
  const watched = useWatchlistStore((s) => s.items.some((it) => it.code === code));
  if (watched) {
    return <span className="text-2xs text-[var(--fg-muted)]">{zhCN.search.added}</span>;
  }
  return (
    <Tooltip content={zhCN.search.add}>
      <button
        aria-label={zhCN.search.add}
        onClick={onAdd}
        className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--row-selected)] hover:text-[var(--accent)]"
      >
        <Plus size={12} />
        {zhCN.search.add}
      </button>
    </Tooltip>
  );
}
