import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 分页预加载 Hook：加载当前页后自动在后台预取下一页，
 * 翻页时若命中缓存立即渲染（零等待），并继续预取下下页。
 *
 * @param fetcher 页码 → 数据的加载函数（返回 null 表示失败）
 * @param depsKey 筛选/排序条件序列化后的字符串，变化时清空缓存并回到第 1 页
 */
export function usePrefetchPager<T>(fetcher: (pageIndex: number) => Promise<T | null>, depsKey: string) {
  const [page, setPage] = useState<T | null>(null);
  const [pageIndex, setPageIndex] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const cacheRef = useRef(new Map<number, T>());
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // 正在请求中的页码集合，避免重复请求
  const inflightRef = useRef(new Set<number>());
  // depsKey 变化代次，过期响应直接丢弃
  const epochRef = useRef(0);

  /** 后台静默加载某页进缓存 */
  const prefetch = useCallback((idx: number) => {
    if (idx < 1 || cacheRef.current.has(idx) || inflightRef.current.has(idx)) return;
    const epoch = epochRef.current;
    inflightRef.current.add(idx);
    void fetcherRef.current(idx).then((data) => {
      inflightRef.current.delete(idx);
      if (data && epoch === epochRef.current) {
        cacheRef.current.set(idx, data);
      }
    });
  }, []);

  /** 跳转页码：缓存命中立即渲染，否则前台加载；随后预取下一页 */
  const goto = useCallback(
    (idx: number) => {
      setPageIndex(idx);
      const cached = cacheRef.current.get(idx);
      if (cached) {
        setPage(cached);
        setFailed(false);
        prefetch(idx + 1);
        return;
      }
      const epoch = epochRef.current;
      setLoading(true);
      setFailed(false);
      void fetcherRef.current(idx).then((data) => {
        if (epoch !== epochRef.current) return;
        setLoading(false);
        if (data) {
          cacheRef.current.set(idx, data);
          setPage(data);
          prefetch(idx + 1);
        } else {
          setFailed(true);
        }
      });
    },
    [prefetch]
  );

  // 条件变化：清缓存、回第 1 页
  useEffect(() => {
    epochRef.current += 1;
    cacheRef.current.clear();
    inflightRef.current.clear();
    goto(1);
  }, [depsKey, goto]);

  return { page, pageIndex, loading, failed, goto };
}
