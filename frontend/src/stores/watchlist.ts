import { create } from "zustand";
import type {
  PortfolioSummary,
  Position,
  WatchGroup,
  WatchItem,
} from "@bindings/minifund/internal/model";
import { PortfolioService, WatchlistService } from "@bindings/minifund/services";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";

/** 「汇总」虚拟分组 id：真实分组 id 由数据库自增恒 ≥ 1，0 不会冲突。不入库。 */
export const SUMMARY_GROUP_ID = 0;

/** 是否为「汇总」虚拟分组 */
export function isSummaryGroup(id: number | null): boolean {
  return id === SUMMARY_GROUP_ID;
}

/** 「汇总」虚拟分组对象（固定排在分组栏第一位、统计全部自选） */
const summaryGroup: WatchGroup = { id: SUMMARY_GROUP_ID, name: zhCN.watchlist.summaryGroup, sort: -1 } as WatchGroup;

/** 在真实分组前插入「汇总」虚拟分组 */
function withSummary(realGroups: WatchGroup[]): WatchGroup[] {
  return [summaryGroup, ...realGroups];
}

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
  /** 将基金从当前分组移动到目标分组 */
  moveFund: (code: string, toGroupId: number) => Promise<void>;
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
    const realGroups = await call("加载分组", () => WatchlistService.ListGroups());
    if (!realGroups || realGroups.length === 0) return;
    const groups = withSummary(realGroups);
    // 默认进入「汇总」分组（统计全部自选与持仓）
    const activeGroupId = get().activeGroupId ?? SUMMARY_GROUP_ID;
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
    // 「汇总」分组：加载所有分组去重后的全部自选
    const items = isSummaryGroup(groupId)
      ? await call("加载全部自选", () => WatchlistService.ListAllItems())
      : await call("加载自选", () => WatchlistService.ListItems(groupId));
    if (items) set({ items });
  },

  refreshSummary: async () => {
    const summary = await call("计算盈亏汇总", () => PortfolioService.GetSummary());
    if (summary) set({ summary });
  },

  addFund: async (code) => {
    let groupId = get().activeGroupId;
    if (groupId == null) return;
    // 「汇总」非真实分组：加自选落到第一个真实分组
    if (isSummaryGroup(groupId)) {
      const real = get().groups.find((g) => !isSummaryGroup(g.id));
      if (!real) return;
      groupId = real.id;
    }
    const ok = await call("添加自选", () => WatchlistService.AddItem(code, groupId));
    if (ok !== null) await get().reloadItems();
  },

  removeFund: async (code) => {
    const groupId = get().activeGroupId;
    if (groupId == null) return;
    // 「汇总」视图：从所有分组彻底移除
    const ok = isSummaryGroup(groupId)
      ? await call("彻底移除自选", () => WatchlistService.RemoveItemFromAll(code))
      : await call("移除自选", () => WatchlistService.RemoveItem(code, groupId));
    if (ok !== null) await get().reloadItems();
  },

  moveFund: async (code, toGroupId) => {
    const fromGroupId = get().activeGroupId;
    if (fromGroupId == null || fromGroupId === toGroupId) return;
    const ok = await call("移动自选", () => WatchlistService.MoveItem(code, fromGroupId, toGroupId));
    if (ok !== null) await get().reloadItems();
  },

  createGroup: async (name) => {
    const group = await call("新建分组", () => WatchlistService.CreateGroup(name));
    if (group) {
      const realGroups = await call("加载分组", () => WatchlistService.ListGroups());
      if (realGroups) set({ groups: withSummary(realGroups), activeGroupId: group.id });
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
