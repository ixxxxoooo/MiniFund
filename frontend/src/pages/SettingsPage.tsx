import { useState } from "react";
import { FundService } from "@bindings/minifund/services";
import { Button } from "@/components/ui/button";
import { zhCN } from "@/i18n/zh-CN";
import { call } from "@/lib/wails/call";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useWatchlistStore } from "@/stores/watchlist";

/** 设置分区容器 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h2>
      <div className="flex flex-col divide-y divide-[var(--border-subtle)] rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
        {children}
      </div>
    </section>
  );
}

/** 单行设置项 */
function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-[var(--size-padding)] py-[var(--size-padding-sm)]">
      <div className="flex min-w-0 flex-col">
        <span className="text-[length:var(--size-font-xs)] text-[var(--fg)]">{label}</span>
        {desc && <span className="text-2xs text-[var(--fg-muted)]">{desc}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 主题样式的下拉选择 */
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[var(--size-input-sm)] min-w-[140px] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-xs)] text-[var(--fg)] outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 开关 */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[var(--border-color)]"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/**
 * 设置页：外观 / 监控 / 行为 / 数据。
 * 所有变更即时持久化到 Go 侧 SQLite。
 */
export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const items = useWatchlistStore((s) => s.items);
  const [indexState, setIndexState] = useState<"idle" | "loading" | "done" | "failed">("idle");

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
        {zhCN.common.loading}
      </div>
    );
  }

  // 托盘标题展示候选：关闭 + 指数目录 + 自选基金
  const trayOptions = [
    { value: "", label: zhCN.settings.trayTargetOff },
    ...zhCN.indexCatalog.map((idx) => ({ value: idx.symbol, label: idx.name })),
    ...items.map((it) => ({ value: it.code, label: `${it.name || it.code}` })),
  ];

  const handleRefreshIndex = async () => {
    setIndexState("loading");
    const ok = await call("更新基金代码表", () => FundService.RefreshFundIndex());
    setIndexState(ok !== null ? "done" : "failed");
  };

  return (
    <div className="scroll-always min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[640px] flex-col gap-5 p-[var(--size-padding)]">
        <Section title={zhCN.settings.appearance}>
          <Row label={zhCN.settings.theme}>
            <Select
              value={settings.theme}
              options={Object.entries(zhCN.settings.themeOptions).map(([value, label]) => ({ value, label }))}
              onChange={(v) => void update({ theme: v })}
            />
          </Row>
          <Row label={zhCN.settings.compact}>
            <Toggle
              checked={settings.compactMode}
              onChange={(v) => void update({ compactMode: v })}
              label={zhCN.settings.compact}
            />
          </Row>
          <Row label={zhCN.settings.quoteColor}>
            <Select
              value={settings.quoteColorScheme}
              options={Object.entries(zhCN.settings.quoteColorOptions).map(([value, label]) => ({ value, label }))}
              onChange={(v) => void update({ quoteColorScheme: v })}
            />
          </Row>
        </Section>

        <Section title={zhCN.settings.monitor}>
          <Row label={zhCN.settings.refreshInterval}>
            <Select
              value={String(settings.refreshIntervalSec)}
              options={[15, 30, 60].map((v) => ({ value: String(v), label: `${v} ${zhCN.settings.intervalUnit}` }))}
              onChange={(v) => void update({ refreshIntervalSec: Number(v) })}
            />
          </Row>
          <Row label={zhCN.settings.trayTarget}>
            <Select
              value={settings.trayTitleTarget}
              options={trayOptions}
              onChange={(v) => void update({ trayTitleTarget: v })}
            />
          </Row>
          <Row label={zhCN.settings.stealth} desc={zhCN.settings.stealthDesc}>
            <Toggle
              checked={settings.stealthMode}
              onChange={(v) => void update({ stealthMode: v })}
              label={zhCN.settings.stealth}
            />
          </Row>
          <Row label={zhCN.settings.watchedIndexes}>
            <div className="flex max-w-[280px] flex-wrap justify-end gap-1">
              {zhCN.indexCatalog.map((idx) => {
                const active = settings.watchedIndexes.includes(idx.symbol);
                return (
                  <button
                    key={idx.symbol}
                    onClick={() => {
                      const next = active
                        ? settings.watchedIndexes.filter((s) => s !== idx.symbol)
                        : [...settings.watchedIndexes, idx.symbol];
                      void update({ watchedIndexes: next });
                    }}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-2xs",
                      active
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "bg-[var(--surface)] text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
                    )}
                  >
                    {idx.name}
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>

        <Section title={zhCN.settings.behavior}>
          <Row label={zhCN.settings.closeAction}>
            <Select
              value={settings.closeAction}
              options={Object.entries(zhCN.settings.closeActionOptions).map(([value, label]) => ({ value, label }))}
              onChange={(v) => void update({ closeAction: v })}
            />
          </Row>
        </Section>

        <Section title={zhCN.settings.data}>
          <Row label={zhCN.settings.refreshFundIndex} desc={zhCN.settings.refreshFundIndexDesc}>
            <div className="flex items-center gap-2">
              {indexState === "done" && <span className="text-2xs text-[var(--success)]">{zhCN.settings.refreshDone}</span>}
              {indexState === "failed" && <span className="text-2xs text-[var(--danger)]">{zhCN.settings.refreshFailed}</span>}
              <Button size="sm" variant="outline" disabled={indexState === "loading"} onClick={() => void handleRefreshIndex()}>
                {indexState === "loading" ? zhCN.settings.refreshing : zhCN.settings.refreshFundIndex}
              </Button>
            </div>
          </Row>
          <Row label={zhCN.settings.about}>
            <span className="text-2xs text-[var(--fg-muted)]">
              {zhCN.app.name} v0.0.1 · {zhCN.app.slogan}
            </span>
          </Row>
        </Section>
      </div>
    </div>
  );
}
