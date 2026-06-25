import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 主窗口页面标识 */
export type PageId = "market" | "watchlist" | "search" | "analysis" | "ranking" | "sectors" | "news" | "settings";

interface UIStore {
  /** 当前页面 */
  page: PageId;
  /** 隐藏金额（隐私），持久化到 localStorage */
  hideAmounts: boolean;
  /**
   * 搜索聚焦信号：每次自增触发搜索页输入框重新聚焦并选中已有文字。
   * 用于「顶部搜索框 / ⌘K / 空状态按钮」统一跳到搜索页并直接输入（即便已在搜索页也能重新聚焦）。
   */
  searchFocusNonce: number;
  setPage: (page: PageId) => void;
  toggleHideAmounts: () => void;
  /** 切到「基金搜索」页并聚焦输入框（统一搜索入口） */
  focusSearch: () => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      // 默认进入搜索页：用户最常见的操作是先搜基金再加自选，搜索作为第一入口。
      page: "search",
      hideAmounts: false,
      searchFocusNonce: 0,
      setPage: (page) => set({ page }),
      toggleHideAmounts: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
      focusSearch: () => set((s) => ({ page: "search", searchFocusNonce: s.searchFocusNonce + 1 })),
    }),
    {
      name: "minifund-ui",
      // 仅持久化隐私开关，页面与搜索状态不持久化
      partialize: (s) => ({ hideAmounts: s.hideAmounts }) as UIStore,
    }
  )
);
