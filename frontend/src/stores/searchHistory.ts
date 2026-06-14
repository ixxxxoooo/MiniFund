import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 搜索历史最多保留条数 */
const MAX_HISTORY = 10;

/**
 * 搜索历史（持久化到 localStorage）：记录最近的搜索关键字，去重置顶、最多 10 条。
 * 供搜索页在搜索框下方以胶囊形式展示，可一键回填或清空。
 */
interface SearchHistoryStore {
  /** 最近搜索关键字（最新在前） */
  items: string[];
  /** 记录一次搜索：已存在则置顶，超出上限截断 */
  push: (keyword: string) => void;
  /** 清空全部历史 */
  clear: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryStore>()(
  persist(
    (set) => ({
      items: [],
      push: (keyword) => {
        const kw = keyword.trim();
        if (!kw) return;
        set((s) => ({ items: [kw, ...s.items.filter((it) => it !== kw)].slice(0, MAX_HISTORY) }));
      },
      clear: () => set({ items: [] }),
    }),
    { name: "minifund-search-history" }
  )
);
