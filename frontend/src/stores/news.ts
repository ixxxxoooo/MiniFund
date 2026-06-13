import { create } from "zustand";
import type { NewsArticle, NewsFlash } from "@bindings/minifund/internal/model";
import { NewsService } from "@bindings/minifund/services";
import { call } from "@/lib/wails/call";
import { onNewsFlash } from "@/lib/wails/events";

interface NewsStore {
  /** 快讯列表（时间倒序） */
  flash: NewsFlash[];
  /** 基金资讯列表 */
  roll: NewsArticle[];
  flashLoaded: boolean;
  rollLoaded: boolean;
  rollLoading: boolean;
  rollFailed: boolean;
  /** 未读新快讯数（用于导航红点） */
  unread: number;
  /** 已读游标：该 id 及更早视为已读 */
  lastReadId: string;
  /** 初始化：拉取首屏快讯并订阅推送事件，返回取消订阅函数 */
  init: () => () => void;
  /** 手动刷新快讯 */
  refreshFlash: () => Promise<void>;
  /** 加载基金资讯列表（首次或强制刷新） */
  loadRoll: (force?: boolean) => Promise<void>;
  /** 标记快讯已读（进入快讯页时调用） */
  markRead: () => void;
}

/** 用最新列表更新快讯，并按已读游标重算未读数 */
function applyFlash(state: NewsStore, list: NewsFlash[]): Partial<NewsStore> {
  if (list.length === 0) return { flash: list, flashLoaded: true };
  // 首次加载：全部视为已读，不弹红点
  if (!state.flashLoaded || state.lastReadId === "") {
    return { flash: list, flashLoaded: true, lastReadId: list[0].id, unread: 0 };
  }
  let unread = 0;
  for (const n of list) {
    if (n.id === state.lastReadId) break;
    unread++;
  }
  return { flash: list, flashLoaded: true, unread };
}

export const useNewsStore = create<NewsStore>()((set, get) => ({
  flash: [],
  roll: [],
  flashLoaded: false,
  rollLoaded: false,
  rollLoading: false,
  rollFailed: false,
  unread: 0,
  lastReadId: "",

  init: () => {
    void (async () => {
      const list = await call("加载快讯", () => NewsService.GetFlashNews());
      if (list) set((s) => applyFlash(s, list));
    })();
    return onNewsFlash((list) => set((s) => applyFlash(s, list)));
  },

  refreshFlash: async () => {
    await call("刷新快讯", () => NewsService.RefreshFlashNews());
    const list = await call("加载快讯", () => NewsService.GetFlashNews());
    if (list) set((s) => applyFlash(s, list));
  },

  loadRoll: async (force) => {
    if (get().rollLoaded && !force) return;
    set({ rollLoading: true, rollFailed: false });
    const list = await call("加载基金资讯", () => NewsService.GetRollNews());
    if (list) {
      set({ roll: list, rollLoaded: true, rollLoading: false });
    } else {
      set({ rollLoading: false, rollFailed: true });
    }
  },

  markRead: () => {
    const { flash } = get();
    set({ unread: 0, lastReadId: flash[0]?.id ?? "" });
  },
}));
