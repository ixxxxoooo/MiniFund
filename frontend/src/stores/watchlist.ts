import { create } from "zustand";
import type {
  PortfolioSummary,
  Position,
  WatchGroup,
  WatchItem,
} from "@bindings/minifund/internal/model";
import { PortfolioService, WatchlistService } from "@bindings/minifund/services";
import { call } from "@/lib/wails/call";

interface WatchlistStore {
  groups: WatchGroup[];
  activeGroupId: number | null;
  items: WatchItem[];
  /** 持仓：code → Position */
  positions: Record<string, Position>;
  summary: PortfolioSummary | null;
  loaded: boolean;

  /** 全量加载分组、当前分组条目、持仓与汇总 */
  load: () => Promise<void>;
  /** 切换分组并加载条目 */
  setActiveGroup: (id: number) => Promise<void>;
  /** 重新加载当前分组条目 */
  reloadItems: () => Promise<void>;
  refreshSummary: () => Promise<void>;

  addFund: (code: string) => Promise<void>;
  removeFund: (code: string) => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  deleteGroup: (id: number) => Promise<void>;
  savePosition: (code: string, shares: number, costPrice: number) => Promise<void>;
  deletePosition: (code: string) => Promise<void>;
}

/** 持仓数组转 map */
function toPositionMap(list: Position[]): Record<string, Position> {
  const map: Record<string, Position> = {};
  for (const p of list) map[p.code] = p;
  return map;
}

export const useWatchlistStore = create<WatchlistStore>()((set, get) => ({
  groups: [],
  activeGroupId: null,
  items: [],
  positions: {},
  summary: null,
  loaded: false,

  load: async () => {
    const groups = await call("加载分组", () => WatchlistService.ListGroups());
    if (!groups || groups.length === 0) return;
    const activeGroupId = get().activeGroupId ?? groups[0].id;
    set({ groups, activeGroupId, loaded: true });
    await Promise.all([
      get().reloadItems(),
      call("加载持仓", () => PortfolioService.ListPositions()).then((list) => {
        if (list) set({ positions: toPositionMap(list) });
      }),
      get().refreshSummary(),
    ]);
  },

  setActiveGroup: async (id) => {
    set({ activeGroupId: id });
    await get().reloadItems();
  },

  reloadItems: async () => {
    const groupId = get().activeGroupId;
    if (groupId == null) return;
    const items = await call("加载自选", () => WatchlistService.ListItems(groupId));
    if (items) set({ items });
  },

  refreshSummary: async () => {
    const summary = await call("计算盈亏汇总", () => PortfolioService.GetSummary());
    if (summary) set({ summary });
  },

  addFund: async (code) => {
    const groupId = get().activeGroupId;
    if (groupId == null) return;
    const ok = await call("添加自选", () => WatchlistService.AddItem(code, groupId));
    if (ok !== null) await get().reloadItems();
  },

  removeFund: async (code) => {
    const groupId = get().activeGroupId;
    if (groupId == null) return;
    const ok = await call("移除自选", () => WatchlistService.RemoveItem(code, groupId));
    if (ok !== null) await get().reloadItems();
  },

  createGroup: async (name) => {
    const group = await call("新建分组", () => WatchlistService.CreateGroup(name));
    if (group) {
      const groups = await call("加载分组", () => WatchlistService.ListGroups());
      if (groups) set({ groups, activeGroupId: group.id });
      await get().reloadItems();
    }
  },

  deleteGroup: async (id) => {
    const ok = await call("删除分组", () => WatchlistService.DeleteGroup(id));
    if (ok !== null) {
      set({ activeGroupId: null });
      await get().load();
    }
  },

  savePosition: async (code, shares, costPrice) => {
    const ok = await call("保存持仓", () => PortfolioService.UpsertPosition(code, shares, costPrice));
    if (ok !== null) {
      const list = await call("加载持仓", () => PortfolioService.ListPositions());
      if (list) set({ positions: toPositionMap(list) });
      await get().refreshSummary();
    }
  },

  deletePosition: async (code) => {
    const ok = await call("删除持仓", () => PortfolioService.DeletePosition(code));
    if (ok !== null) {
      const list = await call("加载持仓", () => PortfolioService.ListPositions());
      if (list) set({ positions: toPositionMap(list) });
      await get().refreshSummary();
    }
  },
}));
