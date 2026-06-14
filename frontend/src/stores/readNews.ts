import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 已读新闻最多记录条数（超出后淘汰最旧的） */
const MAX_READ = 1000;

/**
 * 新闻已读状态（持久化到 localStorage）：记录已点开阅读过的快讯/资讯 id。
 * 未读条目在列表右侧显示小绿点，点击阅读后标记为已读（绿点消失），重开后仍保持。
 */
interface ReadNewsStore {
  /** 已读 id 列表（最新在前，去重，最多 MAX_READ 条） */
  ids: string[];
  /** 标记一条为已读 */
  markRead: (id: string) => void;
}

export const useReadNewsStore = create<ReadNewsStore>()(
  persist(
    (set) => ({
      ids: [],
      markRead: (id) =>
        set((s) => (s.ids.includes(id) ? s : { ids: [id, ...s.ids].slice(0, MAX_READ) })),
    }),
    { name: "minifund-read-news" }
  )
);
