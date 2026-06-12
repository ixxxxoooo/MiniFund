import { create } from "zustand";
import type { FundEstimate, IndexQuote, MonitorState } from "@bindings/minifund/internal/model";
import { MarketService } from "@bindings/minifund/services";
import { call } from "@/lib/wails/call";
import { onDegraded, onEstimates, onIndexes, onMonitorState, onNavConfirmed } from "@/lib/wails/events";
import { useWatchlistStore } from "./watchlist";

interface MarketStore {
  /** 自选估值：code → 估值 */
  estimates: Record<string, FundEstimate>;
  /** 估值最近更新时间戳（驱动表格闪烁动画） */
  estimatesUpdatedAt: number;
  /** 指数行情 */
  indexes: IndexQuote[];
  /** 监控状态 */
  monitor: MonitorState | null;
  /** 数据源是否降级 */
  degraded: boolean;
  /** 初始化：拉取缓存快照并订阅事件（每个窗口调用一次） */
  init: () => void;
  /** 手动触发一轮拉取 */
  refreshNow: () => void;
}

/** 估值数组转 map */
function toEstimateMap(list: FundEstimate[]): Record<string, FundEstimate> {
  const map: Record<string, FundEstimate> = {};
  for (const e of list) map[e.code] = e;
  return map;
}

let initialized = false;

export const useMarketStore = create<MarketStore>()((set) => ({
  estimates: {},
  estimatesUpdatedAt: 0,
  indexes: [],
  monitor: null,
  degraded: false,

  init: () => {
    if (initialized) return;
    initialized = true;

    // 初始快照（调度器缓存，避免等待下一轮推送）
    void call("加载估值快照", () => MarketService.GetEstimates()).then((list) => {
      if (list) set({ estimates: toEstimateMap(list), estimatesUpdatedAt: Date.now() });
    });
    void call("加载指数快照", () => MarketService.GetIndexQuotes()).then((list) => {
      if (list) set({ indexes: list });
    });
    void call("加载监控状态", () => MarketService.GetMonitorState()).then((state) => {
      if (state) set({ monitor: state });
    });

    // 事件订阅：周期数据全部由 Go 推送
    onEstimates((list) => {
      set({ estimates: toEstimateMap(list), estimatesUpdatedAt: Date.now() });
      // 估值刷新后联动持仓盈亏汇总
      void useWatchlistStore.getState().refreshSummary();
    });
    onIndexes((list) => set({ indexes: list }));
    onMonitorState((state) => set({ monitor: state }));
    onDegraded((payload) => set({ degraded: payload.degraded }));
    onNavConfirmed(() => {
      // 净值确认后刷新汇总（真实收益落库）
      void useWatchlistStore.getState().refreshSummary();
    });
  },

  refreshNow: () => {
    void call("手动刷新", () => MarketService.RefreshNow());
  },
}));
