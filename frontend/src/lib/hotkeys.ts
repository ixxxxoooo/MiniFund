import { useEffect, useRef } from "react";

/**
 * 全局快捷键 Hook。
 * key 格式："meta+k"、"meta+1"、"escape"、"meta+w"（meta 在 macOS 上为 ⌘）。
 * 输入框聚焦时跳过单键快捷键（Escape 除外），带修饰键的组合仍然生效。
 */
export function useHotkeys(handlers: Record<string, (e: KeyboardEvent) => void>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.metaKey) parts.push("meta");
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");

      const handler = handlersRef.current[combo];
      if (!handler) return;

      // 输入框聚焦时仅放行 Escape 和带 meta/ctrl 的组合
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (inInput && combo !== "escape" && !e.metaKey && !e.ctrlKey) return;

      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
