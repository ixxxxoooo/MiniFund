import { TitleBar } from "@/components/layout/TitleBar";
import { zhCN } from "@/i18n/zh-CN";
import { Window } from "@wailsio/runtime";

interface DetailWindowProps {
  /** 基金代码，来自 hash 路由 /#/detail/{code} */
  code: string;
}

/**
 * 基金详情独立窗口。
 * 当前为骨架占位，详情数据接入见 docs/ROADMAP.md 里程碑 M2（任务 11/12）。
 */
export function DetailWindow({ code }: DetailWindowProps) {
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <TitleBar onClose={() => void Window.Close()}>
        <span className="text-[length:var(--size-font-xs)] font-medium text-[var(--fg)]">
          基金详情 · {code}
        </span>
      </TitleBar>
      <main className="flex flex-1 items-center justify-center text-[length:var(--size-font-sm)] text-[var(--fg-muted)]">
        {zhCN.detail.loading}
      </main>
    </div>
  );
}
