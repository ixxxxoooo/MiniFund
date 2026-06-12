import { useMemo, useState } from "react";

/** 排序方向：null 表示恢复默认顺序 */
export type SortDir = "asc" | "desc" | null;

export interface SortState {
  key: string | null;
  dir: SortDir;
}

/**
 * 本地表格排序 Hook：点击列头按 desc → asc → 默认 循环。
 * @param items 原始数据
 * @param accessors 列 key → 取值函数（number 或 string）
 */
export function useLocalSort<T>(
  items: T[],
  accessors: Record<string, (item: T) => number | string>
) {
  const [state, setState] = useState<SortState>({ key: null, dir: null });

  const toggle = (key: string) => {
    setState((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return { key: null, dir: null };
    });
  };

  const sorted = useMemo(() => {
    if (!state.key || !state.dir) return items;
    const accessor = accessors[state.key];
    if (!accessor) return items;
    const factor = state.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * factor;
      }
      return String(va).localeCompare(String(vb), "zh-CN") * factor;
    });
    // accessors 为字面量常量，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, state]);

  return { sorted, sortState: state, toggle };
}
