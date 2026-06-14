import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 主窗口页面标识 */
export type PageId = "market" | "watchlist" | "search" | "analysis" | "ranking" | "sectors" | "news" | "settings";

interface UIStore {
  /** 当前页面 */
  page: PageId;
  /** 隐藏金额（隐私），持久化到 localStorage */
  hideAmounts: boolean;
  /** 搜索面板是否打开 */
  searchOpen: boolean;
  setPage: (page: PageId) => void;
  toggleHideAmounts: () => void;
  setSearchOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      page: "market",
      hideAmounts: false,
      searchOpen: false,
      setPage: (page) => set({ page }),
      toggleHideAmounts: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
      setSearchOpen: (open) => set({ searchOpen: open }),
    }),
    {
      name: "minifund-ui",
      // 仅持久化隐私开关，页面与搜索状态不持久化
      partialize: (s) => ({ hideAmounts: s.hideAmounts }) as UIStore,
    }
  )
);
