import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 表格列显隐配置（持久化到 localStorage）。
 * 按表格 id 记录被隐藏的列 key 集合；默认隐藏列在首次注册时写入。
 */
interface ColumnsStore {
  /** tableId → 被隐藏的列 key 列表 */
  hidden: Record<string, string[]>;
  /** 首次注册某表格的默认隐藏列（已存在则不覆盖，保留用户选择） */
  ensure: (tableId: string, defaultHidden: string[]) => void;
  /** 切换某列显隐 */
  toggle: (tableId: string, key: string) => void;
  /** 判断某列是否隐藏 */
  isHidden: (tableId: string, key: string) => boolean;
}

export const useColumnsStore = create<ColumnsStore>()(
  persist(
    (set, get) => ({
      hidden: {},

      ensure: (tableId, defaultHidden) => {
        if (get().hidden[tableId] === undefined) {
          set((s) => ({ hidden: { ...s.hidden, [tableId]: defaultHidden } }));
        }
      },

      toggle: (tableId, key) =>
        set((s) => {
          const cur = s.hidden[tableId] ?? [];
          const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
          return { hidden: { ...s.hidden, [tableId]: next } };
        }),

      isHidden: (tableId, key) => (get().hidden[tableId] ?? []).includes(key),
    }),
    { name: "minifund-columns" }
  )
);
