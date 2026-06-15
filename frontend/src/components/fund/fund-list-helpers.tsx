import { useEffect, useRef, useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
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

/** 收益分批拉取的批大小：大结果集（搜索全量排序）分批合并，表格渐进填充并实时重排。 */
const PERF_CHUNK = 40;

/**
 * 批量补全一组基金的阶段收益（code → 收益：今日/近1周/近1月/近3月/近1年/今年来）。
 * codes 变化时增量合并；后端命中 3 分钟缓存，翻页几乎零等待。
 * codes 较多时（如搜索页全量排序，最多 300 只）按 PERF_CHUNK 分批顺序拉取，
 * 每批返回即合并，表格随之渐进填充并自动重排，避免一次性长等待。
 */
export function useFundPerformance(codes: string[]): Record<string, FundPerf | undefined> {
  const [map, setMap] = useState<Record<string, FundPerf | undefined>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (codes.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < codes.length; i += PERF_CHUNK) {
        if (cancelled) return;
        const chunk = codes.slice(i, i + PERF_CHUNK);
        const res = await call("加载基金收益", () => FundService.GetFundPerformance(chunk));
        if (cancelled || !res) continue;
        setMap((prev) => ({ ...prev, ...res }));
      }
    })();
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
 * 基金所属主题标签：彩色药丸（按主题名稳定取色），默认最多展示 2 个，多余以 +N 折叠，hover 显示全部。
 * max 控制最多展示数量（详情页空间充裕可调大）。配色取自 globals.css 的 --chip-* token（规避红/绿）。
 */
export function ThemeChips({ themes, className, max = 2 }: { themes?: FundTheme[]; className?: string; max?: number }) {
  if (!themes || themes.length === 0) return null;
  const shown = themes.slice(0, max);
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

/**
 * 复制文本到剪贴板：优先 navigator.clipboard，降级到隐藏 textarea + execCommand，
 * 兼容 Wails WebView 非安全上下文。返回是否成功。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下方兜底方案
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 复制图标按钮：用于列表基金名称旁，悬浮显示，点击复制，成功后短暂显示对勾。
 * 传入 name 时复制「名称 代码」（便于粘贴后一眼识别），否则仅复制 value（代码）。
 * 默认随父级 group-hover 显示（父元素需带 `group` 类），可用 alwaysVisible 关闭该行为。
 */
export function CopyButton({
  value,
  name,
  className,
  alwaysVisible = false,
}: {
  value: string;
  name?: string;
  className?: string;
  alwaysVisible?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // 复制内容：有名称则「名称 代码」，否则仅代码
  const text = name ? `${name} ${value}` : value;
  return (
    <Tooltip content={copied ? zhCN.common.copied : zhCN.common.copyCode}>
      <button
        aria-label={zhCN.common.copyCode}
        onClick={(e) => {
          e.stopPropagation();
          void copyText(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1200);
          });
        }}
        className={cn(
          "shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--row-selected)] hover:text-[var(--accent)]",
          !alwaysVisible && "opacity-0 group-hover:opacity-100 focus:opacity-100",
          className
        )}
      >
        {copied ? <Check size={12} className="text-[var(--quote-up)]" /> : <Copy size={12} />}
      </button>
    </Tooltip>
  );
}

/**
 * 持仓状态徽标：展示在基金代码后面。
 * 持有（当前份额 > 0）显示绿色「持有」；已清仓（曾买入、当前份额为 0）显示灰色「已清仓」；
 * 无任何交易记录则不渲染。再次买入后由后端重算自动恢复为「持有」。
 */
export function PositionStatusBadge({ code, className }: { code: string; className?: string }) {
  const held = useWatchlistStore((s) => (s.positions[code]?.shares ?? 0) > 0);
  const cleared = useWatchlistStore((s) => s.clearedCodes.includes(code));
  if (!held && !cleared) return null;
  const label = held ? zhCN.position.statusHeld : zhCN.position.statusCleared;
  return (
    <span
      className={cn(
        "shrink-0 rounded-[var(--radius-sm)] px-1 py-px text-[10px] font-medium leading-tight",
        held
          ? "bg-[var(--row-selected)] text-[var(--accent)]"
          : "bg-[var(--surface-secondary)] text-[var(--fg-muted)]",
        className
      )}
    >
      {label}
    </span>
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
