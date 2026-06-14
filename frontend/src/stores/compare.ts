import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 单次对比最多基金数 */
export const COMPARE_MAX = 6;
/** 历史对比批次最多保留条数 */
const MAX_HISTORY = 10;

/**
 * 基金对比状态（持久化到 localStorage）：
 * - selected：当前对比的基金代码集合，切换菜单/重开窗口后保持不清空；
 * - history：历史对比批次（最新在前），清空当前对比时归档，可一键恢复。
 */
interface CompareStore {
  /** 当前已选基金代码 */
  selected: string[];
  /** 历史对比批次（每批为一组代码，最新在前） */
  history: string[][];
  /** 加入/移除一只基金（已满则忽略新增） */
  toggle: (code: string) => void;
  /** 移除一只基金 */
  remove: (code: string) => void;
  /** 清空当前对比：达到 2 只及以上时先归档到历史 */
  clear: () => void;
  /** 从历史批次恢复为当前对比 */
  restore: (batch: string[]) => void;
  /** 清空历史 */
  clearHistory: () => void;
}

/** 两批次代码集合是否相同（无序比较） */
function sameBatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((c) => set.has(c));
}

export const useCompareStore = create<CompareStore>()(
  persist(
    (set) => ({
      selected: [],
      history: [],

      toggle: (code) =>
        set((s) => {
          if (s.selected.includes(code)) return { selected: s.selected.filter((c) => c !== code) };
          if (s.selected.length >= COMPARE_MAX) return s;
          return { selected: [...s.selected, code] };
        }),

      remove: (code) => set((s) => ({ selected: s.selected.filter((c) => c !== code) })),

      clear: () =>
        set((s) => {
          if (s.selected.length < 2) return { selected: [] };
          const history = [s.selected, ...s.history.filter((b) => !sameBatch(b, s.selected))].slice(0, MAX_HISTORY);
          return { selected: [], history };
        }),

      restore: (batch) => set({ selected: batch.slice(0, COMPARE_MAX) }),

      clearHistory: () => set({ history: [] }),
    }),
    { name: "minifund-compare" }
  )
);
