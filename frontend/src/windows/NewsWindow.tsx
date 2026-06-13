import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Window } from "@wailsio/runtime";
import { AIService, NewsService } from "@bindings/minifund/services";
import { TitleBar } from "@/components/layout/TitleBar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
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
  const [contentLoading, setContentLoading] = useState(data?.kind === "roll");
  const [contentFailed, setContentFailed] = useState(false);

  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    void (async () => {
      const ok = await call("检查 AI 配置", () => AIService.Available());
      setAiAvailable(ok ?? false);
    })();
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
      } else if (data.kind === "roll") {
        setContentFailed(true);
      }
      setContentLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [data]);

  const handleAI = async () => {
    setAiOpen(true);
    if (!aiAvailable) {
      setAiError(zhCN.news.aiDisabledHint);
      return;
    }
    setAiLoading(true);
    setAiError("");
    setAiText("");
    try {
      const result = await AIService.InterpretNews(data!.title, content || data!.title);
      setAiText(result);
    } catch (err) {
      setAiError(`${zhCN.news.aiFailed}：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiLoading(false);
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
            <Button size="sm" disabled={aiLoading} onClick={() => void handleAI()}>
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
            {aiLoading ? (
              <Spinner className="justify-start py-1" size={14} label={zhCN.news.aiLoading} />
            ) : aiError ? (
              <p className="text-2xs leading-relaxed text-[var(--danger)]">{aiError}</p>
            ) : (
              <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-[length:var(--size-font-xs)] leading-relaxed text-[var(--fg)]">
                {aiText}
              </p>
            )}
          </section>
        )}

        {/* 正文 */}
        <div className="scroll-always min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-[var(--size-padding)]">
          {contentLoading ? (
            <Spinner className="py-8" label={zhCN.news.contentLoading} />
          ) : contentFailed ? (
            <p className="py-4 text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">{zhCN.news.contentFailed}</p>
          ) : (
            <p className="whitespace-pre-wrap text-[length:var(--size-font-sm)] leading-relaxed text-[var(--fg-secondary)]">
              {content}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
