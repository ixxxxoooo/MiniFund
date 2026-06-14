import { useEffect, useMemo, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { WindowService } from "@bindings/minifund/services";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { Spinner } from "@/components/ui/spinner";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useNewsStore } from "@/stores/news";
import { useSettingsStore } from "@/stores/settings";

type Tab = "flash" | "roll";

/** 列表每页条数 */
const PAGE_SIZE = 20;
/** 快讯自动刷新倒计时兜底（秒）：设置未加载时使用 */
const DEFAULT_REFRESH_SEC = 60;

/** 打开新闻独立窗口所需的载荷 */
interface NewsPayload {
  kind: Tab;
  id: string;
  title: string;
  time: string;
  url: string;
  summary: string;
}

/** 序列化载荷并打开独立窗口（同一 id 复用窗口） */
function openNewsWindow(p: NewsPayload) {
  const b64 = btoa(encodeURIComponent(JSON.stringify(p)));
  void call("打开新闻窗口", () => WindowService.OpenNewsWindow(p.id, b64));
}

/**
 * 财经快讯页：全球快讯（7×24 短讯，定时推送 + 10 秒自动刷新）+ 基金资讯（完整文章）。
 * 列表按时间倒序、支持分页；点击任意条目打开独立窗口查看正文与 AI 解读。
 */
export function NewsPage() {
  const flash = useNewsStore((s) => s.flash);
  const roll = useNewsStore((s) => s.roll);
  const rollLoading = useNewsStore((s) => s.rollLoading);
  const rollFailed = useNewsStore((s) => s.rollFailed);
  const refreshFlash = useNewsStore((s) => s.refreshFlash);
  const loadRoll = useNewsStore((s) => s.loadRoll);
  // 快讯自动刷新间隔与「设置 - 快讯拉取间隔」保持一致
  const refreshSec = useSettingsStore((s) => s.settings?.newsPollSec ?? DEFAULT_REFRESH_SEC);

  const [tab, setTab] = useState<Tab>("flash");
  const [refreshing, setRefreshing] = useState(false);
  const [flashPage, setFlashPage] = useState(1);
  const [rollPage, setRollPage] = useState(1);

  // 顶部时钟 + 倒计时（仅快讯页生效）
  const [now, setNow] = useState(() => new Date());
  const [countdown, setCountdown] = useState(refreshSec);

  useEffect(() => {
    if (tab === "roll") void loadRoll();
  }, [tab, loadRoll]);

  // 快讯页 1 秒心跳：刷新时钟并递减倒计时，归零时自动刷新（间隔跟随设置）
  useEffect(() => {
    if (tab !== "flash") return;
    setCountdown(refreshSec);
    const id = window.setInterval(() => {
      setNow(new Date());
      setCountdown((c) => {
        if (c <= 1) {
          void refreshFlash();
          return refreshSec;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [tab, refreshFlash, refreshSec]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setCountdown(refreshSec);
    if (tab === "flash") await refreshFlash();
    else await loadRoll(true);
    setRefreshing(false);
  };

  // 分页切片（时间倒序由数据源保证）
  const flashTotalPages = Math.max(1, Math.ceil(flash.length / PAGE_SIZE));
  const flashPageClamped = Math.min(flashPage, flashTotalPages);
  const flashView = useMemo(
    () => flash.slice((flashPageClamped - 1) * PAGE_SIZE, flashPageClamped * PAGE_SIZE),
    [flash, flashPageClamped]
  );

  const rollTotalPages = Math.max(1, Math.ceil(roll.length / PAGE_SIZE));
  const rollPageClamped = Math.min(rollPage, rollTotalPages);
  const rollView = useMemo(
    () => roll.slice((rollPageClamped - 1) * PAGE_SIZE, rollPageClamped * PAGE_SIZE),
    [roll, rollPageClamped]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      {/* Tab + 时钟/倒计时 + 刷新 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(["flash", "roll"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                tab === t
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {zhCN.news.tabs[t]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === "flash" && (
            <div className="flex items-center gap-2 text-2xs text-[var(--fg-secondary)]">
              <span className="quote-num flex items-center gap-1 text-[var(--fg-muted)]">
                <Clock size={12} />
                {now.toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
              <span className="quote-num rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-1.5 py-0.5">
                {zhCN.news.autoRefreshIn.replace("{n}", String(countdown))}
              </span>
            </div>
          )}
          <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void handleRefresh()}>
            <RefreshCw size={12} className={cn("mr-1", refreshing && "animate-spin")} />
            {zhCN.news.refresh}
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <div className="scroll-always min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
        {tab === "flash" ? (
          flash.length === 0 ? (
            <Empty text={zhCN.news.empty} />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {flashView.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() =>
                      openNewsWindow({
                        kind: "flash",
                        id: n.id,
                        title: n.title,
                        time: n.time,
                        url: `https://finance.eastmoney.com/a/${n.id}.html`,
                        summary: n.summary,
                      })
                    }
                    className="flex w-full flex-col gap-1 px-[var(--size-padding)] py-2.5 text-left hover:bg-[var(--row-hover)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="quote-num shrink-0 text-2xs text-[var(--fg-muted)]">{n.time}</span>
                      {n.important && (
                        <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--quote-up)] px-1 text-2xs text-white">
                          {zhCN.news.important}
                        </span>
                      )}
                      <span
                        className={cn(
                          "truncate text-[length:var(--size-font-xs)]",
                          n.important ? "font-medium text-[var(--quote-up)]" : "text-[var(--fg)]"
                        )}
                      >
                        {n.title}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-2xs leading-relaxed text-[var(--fg-secondary)]">{n.summary}</p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : rollLoading && roll.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label={zhCN.news.loading} />
          </div>
        ) : rollFailed && roll.length === 0 ? (
          <Empty text={zhCN.news.loadFailed} />
        ) : roll.length === 0 ? (
          <Empty text={zhCN.news.empty} />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {rollView.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() =>
                    openNewsWindow({ kind: "roll", id: a.id, title: a.title, time: a.time, url: a.url, summary: "" })
                  }
                  className="flex w-full items-center gap-3 px-[var(--size-padding)] py-2.5 text-left hover:bg-[var(--row-hover)]"
                >
                  <span className="quote-num shrink-0 text-2xs text-[var(--fg-muted)]">{a.time}</span>
                  <span className="truncate text-[length:var(--size-font-xs)] text-[var(--fg)]">{a.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 分页 */}
      {tab === "flash"
        ? flash.length > PAGE_SIZE && (
            <Pager pageIndex={flashPageClamped} totalPages={flashTotalPages} onGoto={setFlashPage} />
          )
        : roll.length > PAGE_SIZE && (
            <Pager pageIndex={rollPageClamped} totalPages={rollTotalPages} onGoto={setRollPage} />
          )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
      {text}
    </div>
  );
}
