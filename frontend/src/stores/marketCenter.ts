import { create } from "zustand";
import type { Kline, MarketIndexQuote } from "@bindings/minifund/internal/model";
import { MarketService } from "@bindings/minifund/services";
import { call, getLastCallError } from "@/lib/wails/call";
import { onMarketCenter } from "@/lib/wails/events";

/** K 线周期 */
export type KlinePeriod = "day" | "week" | "month";

interface MarketCenterStore {
  /** 指数实时报价列表（含分组） */
  quotes: MarketIndexQuote[];
  /** 当前选中指数 secid */
  selected: string | null;
  /** 当前 K 线周期 */
  period: KlinePeriod;
  /** 当前选中指数的 K 线（按日期升序，最近 klineLimit 根） */
  kline: Kline[];
  /** 是否还有更早历史可加载（向左滚动触发 loadMoreKline） */
  klineMore: boolean;
  /** 当前已请求的 K 线根数（向左滚动时逐步增大，上限 1000） */
  klineLimit: number;
  /** K 线加载中 */
  loadingKline: boolean;
  /** K 线加载错误 */
  klineError: string | null;
  /** 初始化：拉取列表 + 订阅指数事件驱动刷新（仅首次生效）；返回取消订阅函数 */
  init: () => () => void;
  /** 拉取指数实时报价列表（窗口初始化用） */
  loadQuotes: () => Promise<void>;
  /** 应用一批指数报价（初始化拉取与事件推送共用：更新列表 + 首次默认选中） */
  applyQuotes: (list: MarketIndexQuote[]) => void;
  /** 拉取当前选中指数 + 周期的 K 线（初始预加载 INITIAL_LIMIT 根） */
  loadKline: () => Promise<void>;
  /** 向左滚动触发：升至更大 limit 拉取更多历史，返回新前插的更早切片与是否仍有更多 */
  loadMoreKline: () => Promise<{ older: Kline[]; more: boolean }>;
  /** 选中指数 */
  select: (secid: string) => void;
  /** 切换 K 线周期 */
  setPeriod: (p: KlinePeriod) => void;
}

let initialized = false;

/** K 线初始预加载根数与单次步进、上限（与后端 klineMaxLimit 对齐）。 */
const INITIAL_LIMIT = 500;
const LIMIT_STEP = 500;
const MAX_LIMIT = 1000;

export const useMarketCenterStore = create<MarketCenterStore>()((set, get) => ({
  quotes: [],
  selected: null,
  period: "day",
  kline: [],
  klineMore: false,
  klineLimit: 0,
  loadingKline: false,
  klineError: null,

  init: () => {
    if (initialized) return () => {};
    initialized = true;
    void get().loadQuotes();
    // 调度器每 30s 主动拉取并广播行情中心指数（全天候，覆盖美股/韩国盘外时段）；
    // 前端直接消费推送 payload，不自行 setInterval 轮询 binding（遵守架构约定）。
    const unsub = onMarketCenter((list) => {
      if (list && list.length > 0) get().applyQuotes(list);
    });
    // 返回取消函数：卸载时退订并释放守卫，允许后续重新初始化。
    return () => {
      unsub();
      initialized = false;
    };
  },

  loadQuotes: async () => {
    const list = await call("加载行情中心指数", () => MarketService.GetMarketCenterQuotes());
    if (!list) return;
    get().applyQuotes(list);
  },

  applyQuotes: (list) => {
    set({ quotes: list });
    // 首次有数据时默认选中第一个并拉取其 K 线
    if (!get().selected && list.length > 0) {
      set({ selected: list[0].secid });
      void get().loadKline();
    }
  },

  loadKline: async () => {
    const { selected, period } = get();
    if (!selected) return;
    set({ loadingKline: true, klineError: null });
    const k = await call("加载 K 线", () => MarketService.GetIndexKline(selected, period, INITIAL_LIMIT));
    if (k) {
      // 返回根数达到请求量则推断仍有更早历史可加载（向左滚动时拉取）。
      set({ kline: k, klineLimit: INITIAL_LIMIT, klineMore: k.length >= INITIAL_LIMIT, loadingKline: false });
    } else {
      set({ loadingKline: false, klineError: getLastCallError() ?? "K 线加载失败" });
    }
  },

  loadMoreKline: async () => {
    const { selected, period, kline, klineLimit, klineMore } = get();
    if (!selected || !klineMore) return { older: [], more: false };
    const newLimit = Math.min(MAX_LIMIT, klineLimit + LIMIT_STEP);
    if (newLimit <= klineLimit) return { older: [], more: false };
    const k = await call("加载更多 K 线", () => MarketService.GetIndexKline(selected, period, newLimit));
    if (!k) return { older: [], more: get().klineMore };
    // 新结果是更长的同序列尾段，其前缀即为新增的更早 K 线。
    const older = k.length > kline.length ? k.slice(0, k.length - kline.length) : [];
    const more = k.length >= newLimit && newLimit < MAX_LIMIT && older.length > 0;
    set({ kline: k, klineLimit: newLimit, klineMore: more });
    return { older, more };
  },

  select: (secid) => {
    if (get().selected === secid) return;
    set({ selected: secid, kline: [], klineMore: false, klineLimit: 0, klineError: null });
    void get().loadKline();
  },

  setPeriod: (p) => {
    if (get().period === p) return;
    set({ period: p, kline: [], klineMore: false, klineLimit: 0, klineError: null });
    void get().loadKline();
  },
}));
