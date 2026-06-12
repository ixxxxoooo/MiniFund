/**
 * bindings 调用统一包装：捕获 Go 侧错误并记录，避免未处理的 Promise 异常。
 * 所有 store 中的写操作必须经过 call() 包装。
 */

/** 最近一次调用错误（设置页/状态栏可展示） */
let lastError: string | null = null;

export function getLastCallError(): string | null {
  return lastError;
}

/**
 * 执行 bindings 调用并统一处理错误。
 * @param action 调用描述（中文，用于错误日志）
 * @param fn 实际调用
 * @returns 成功返回结果，失败返回 null
 */
export async function call<T>(action: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    lastError = null;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastError = `${action}失败: ${message}`;
    console.error(`[MiniFund] ${action}失败:`, err);
    return null;
  }
}
