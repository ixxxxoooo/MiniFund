import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Window } from "@wailsio/runtime";
import { AIService, NewsService } from "@bindings/minifund/services";
import { TitleBar } from "@/components/layout/TitleBar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { onAIChunk, onAIDone, onAIError } from "@/lib/wails/events";
import { renderMarkdown } from "@/lib/markdown";
import { OpenExternalURL } from "@/lib/wails/runtime";
import { useHotkeys } from "@/lib/hotkeys";

interface NewsPayload {
  kind: "flash" | "roll";
  id: string;
  title: string;
  time: string;
  url: string;
  summary: string;
}

/** 从 hash 路由参数解码新闻数据（base64(encodeURIComponent(JSON))） */
function decodePayload(raw: string): NewsPayload | null {
  try {
    return JSON.parse(decodeURIComponent(atob(raw))) as NewsPayload;
  } catch {
    return null;
  }
}

interface NewsWindowProps {
  /** hash 路由 /#/news/{payload} 中的 base64 载荷 */
  payload: string;
}

/**
 * 新闻详情独立窗口：展示正文（资讯/快讯均尝试抓取对应文章页正文），
 * AI 解读结果在正文上方展示，并提供"打开原文"链接。
 */
export function NewsWindow({ payload }: NewsWindowProps) {
  const data = useMemo(() => decodePayload(payload), [payload]);

  useHotkeys({
    escape: () => void Window.Close(),
    "meta+w": () => void Window.Close(),
  });

  // 正文：快讯先以短讯兜底，随后尝试抓取完整文章页；资讯直接抓取
  const [content, setContent] = useState(data?.summary ?? "");
  // 是否为富文本 HTML（抓到完整文章页正文时为 true，含股票超链接与图片）；短讯兜底为纯文本
  const [isHtml, setIsHtml] = useState(false);
  const [contentLoading, setContentLoading] = useState(data?.kind === "roll");
  const [contentFailed, setContentFailed] = useState(false);

  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  // aiStreaming：从发起到结束（含等待首字节与逐字输出）；用于展示加载态与流式光标
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState("");
  // 当前流式会话 ID：用于在事件回调中过滤归属，避免多次点击解读串流
  const streamIdRef = useRef("");

  useEffect(() => {
    void (async () => {
      const ok = await call("检查 AI 配置", () => AIService.Available());
      setAiAvailable(ok ?? false);
    })();
  }, []);

  // 订阅 AI 流式事件：按 streamID 过滤后增量拼接、完成与报错
  useEffect(() => {
    const unsubs = [
      onAIChunk((p) => {
        if (p.id !== streamIdRef.current) return;
        // 载荷为累计全文：取更长者，避免乱序到达的较短旧帧回退覆盖新帧。
        setAiText((prev) => (p.text.length >= prev.length ? p.text : prev));
      }),
      onAIDone((p) => {
        if (p.id !== streamIdRef.current) return;
        setAiStreaming(false);
      }),
      onAIError((p) => {
        if (p.id !== streamIdRef.current) return;
        setAiError(`${zhCN.news.aiFailed}：${p.message}`);
        setAiStreaming(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // 抓取正文：资讯必抓；快讯有对应文章页（finance.eastmoney.com/a/{id}.html）时也抓，失败则保留短讯
  useEffect(() => {
    if (!data || !data.url) return;
    let alive = true;
    if (data.kind === "roll") setContentLoading(true);
    void (async () => {
      const text = await call("抓取正文", () => NewsService.GetArticleContent(data.url));
      if (!alive) return;
      if (text && text.trim().length > 0) {
        setContent(text);
        setIsHtml(true); // 抓到的正文为已清洗的富文本 HTML
      } else if (data.kind === "roll") {
        setContentFailed(true);
      }
      setContentLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [data]);

  // 富文本正文中点击超链接（如个股行情页）用系统浏览器打开
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor?.href) {
      e.preventDefault();
      void OpenExternalURL(anchor.href);
    }
  };

  const handleAI = async () => {
    setAiOpen(true);
    setAiText("");
    setAiError("");
    if (!aiAvailable) {
      setAiError(zhCN.news.aiDisabledHint);
      return;
    }
    // 生成本次流式会话 ID（多次点击以最后一次为准）
    const id = crypto.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    streamIdRef.current = id;
    setAiStreaming(true);
    // 富文本正文先去标签再交给 AI，避免把 HTML 标签当正文
    const plain = isHtml ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : content;
    try {
      await AIService.InterpretNewsStream(id, data!.title, plain || data!.title);
    } catch (err) {
      if (streamIdRef.current !== id) return;
      setAiError(`${zhCN.news.aiFailed}：${err instanceof Error ? err.message : String(err)}`);
      setAiStreaming(false);
    }
  };

  if (!data) {
    return (
      <div className="flex h-full flex-col bg-[var(--surface)]">
        <TitleBar onClose={() => void Window.Close()}>
          <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">{zhCN.news.tabs.flash}</span>
        </TitleBar>
        <main className="flex flex-1 items-center justify-center text-[length:var(--size-font-sm)] text-[var(--fg-muted)]">
          {zhCN.news.loadFailed}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar onClose={() => void Window.Close()}>
        <span className="truncate text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">{data.title}</span>
      </TitleBar>

      <main className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] overflow-hidden p-[var(--size-padding)]">
        {/* 头部：标题 / 时间 / 操作（去原文、AI 解读） */}
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-[length:var(--size-font-base)] font-semibold leading-snug text-[var(--fg)]">
              {data.title}
            </h1>
            <span className="quote-num text-2xs text-[var(--fg-muted)]">{data.time}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.url && (
              <Button variant="ghost" size="sm" onClick={() => void OpenExternalURL(data.url)}>
                <ExternalLink size={12} className="mr-1" />
                {zhCN.news.openOriginal}
              </Button>
            )}
            <Button size="sm" disabled={aiStreaming} onClick={() => void handleAI()}>
              <Sparkles size={12} className="mr-1" />
              {zhCN.news.aiInterpret}
            </Button>
          </div>
        </div>

        {/* AI 解读：在正文上方展示 */}
        {aiOpen && (
          <section className="shrink-0 rounded-[var(--radius-panel)] border border-[var(--accent)] bg-[var(--surface-secondary)] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold text-[var(--accent)]">
              <Sparkles size={12} />
              {zhCN.news.aiTitle}
            </div>
            {aiError ? (
              <p className="text-2xs leading-relaxed text-[var(--danger)]">{aiError}</p>
            ) : aiStreaming && aiText === "" ? (
              <Spinner className="justify-start py-1" size={14} label={zhCN.news.aiLoading} />
            ) : (
              <div className="max-h-[40vh] overflow-y-auto">
                <div
                  className="markdown-body select-text"
                  onClick={handleContentClick}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(aiText) }}
                />
                {aiStreaming && <span className="ai-caret" aria-hidden="true" />}
              </div>
            )}
          </section>
        )}

        {/* 正文 */}
        <div className="scroll-always min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding)]">
          {contentLoading ? (
            <Spinner className="py-8" label={zhCN.news.contentLoading} />
          ) : contentFailed ? (
            <p className="py-4 text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">{zhCN.news.contentFailed}</p>
          ) : isHtml ? (
            <div
              className="news-article select-text"
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <p className="select-text whitespace-pre-wrap text-[length:var(--size-font-sm)] leading-relaxed text-[var(--fg-secondary)]">
              {content}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
