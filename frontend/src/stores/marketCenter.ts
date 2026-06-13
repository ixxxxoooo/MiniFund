import { create } from "zustand";
import type { Kline, MarketIndexQuote } from "@bindings/minifund/internal/model";
import { MarketService } from "@bindings/minifund/services";
import { call, getLastCallError } from "@/lib/wails/call";
import { onIndexes } from "@/lib/wails/events";

/** K 线周期 */
export type KlinePeriod = "day" | "week" | "month";

interface MarketCenterStore {
  /** 指数实时报价列表（含分组） */
  quotes: MarketIndexQuote[];
  /** 当前选中指数 secid */
  selected: string | null;
  /** 当前 K 线周期 */
  period: KlinePeriod;
  /** 当前选中指数的 K 线 */
  kline: Kline[];
  /** K 线加载中 */
  loadingKline: boolean;
  /** K 线加载错误 */
  klineError: string | null;
  /** 初始化：拉取列表 + 订阅指数事件驱动刷新（仅首次生效） */
  init: () => void;
  /** 拉取指数实时报价列表 */
  loadQuotes: () => Promise<void>;
  /** 拉取当前选中指数 + 周期的 K 线 */
  loadKline: () => Promise<void>;
  /** 选中指数 */
  select: (secid: string) => void;
  /** 切换 K 线周期 */
  setPeriod: (p: KlinePeriod) => void;
}

let initialized = false;

export const useMarketCenterStore = create<MarketCenterStore>()((set, get) => ({
  quotes: [],
  selected: null,
  period: "day",
  kline: [],
  loadingKline: false,
  klineError: null,

  init: () => {
    if (initialized) return;
    initialized = true;
    void get().loadQuotes();
    // 借指数行情推送事件驱动列表刷新：后端 5s 缓存合并重复请求，前端不自行 setInterval 轮询（遵守架构约定）。
    onIndexes(() => {
      void get().loadQuotes();
    });
  },

  loadQuotes: async () => {
    const list = await call("加载行情中心指数", () => MarketService.GetMarketCenterQuotes());
    if (!list) return;
    set({ quotes: list });
    // 首次加载默认选中第一个并拉取其 K 线
    if (!get().selected && list.length > 0) {
      set({ selected: list[0].secid });
      void get().loadKline();
    }
  },

  loadKline: async () => {
    const { selected, period } = get();
    if (!selected) return;
    set({ loadingKline: true, klineError: null });
    const k = await call("加载 K 线", () => MarketService.GetIndexKline(selected, period));
    if (k) {
      set({ kline: k, loadingKline: false });
    } else {
      set({ loadingKline: false, klineError: getLastCallError() ?? "K 线加载失败" });
    }
  },

  select: (secid) => {
    if (get().selected === secid) return;
    set({ selected: secid, kline: [], klineError: null });
    void get().loadKline();
  },

  setPeriod: (p) => {
    if (get().period === p) return;
    set({ period: p, kline: [], klineError: null });
    void get().loadKline();
  },
}));
