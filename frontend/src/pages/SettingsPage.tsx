import { useEffect, useState } from "react";
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

/**
 * 主题样式的文本输入（设置项右侧）。
 * 本地维护输入态，失焦或回车时才提交，避免每次按键都写库导致的卡顿/光标跳动。
 */
function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  const commit = () => {
    if (local !== value) onChange(local);
  };
  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-[var(--size-input-sm)] w-[220px] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-xs)] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
    />
  );
}

/**
 * 开关：使用固定像素尺寸（内联 style），避免被 flex/全局按钮样式拉伸导致显示异常。
 * 轨道 38×22，滑块 18×18，开/关分别贴右/贴左。
 */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        padding: 0,
        flex: "none",
        backgroundColor: checked ? "var(--accent)" : "var(--border-color)",
      }}
      className="relative inline-flex shrink-0 items-center transition-colors"
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "9999px",
          backgroundColor: "#fff",
          transform: checked ? "translateX(18px)" : "translateX(2px)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
        className="block transition-transform"
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

        <Section title={zhCN.settings.news}>
          <Row label={zhCN.settings.newsNotify} desc={zhCN.settings.newsNotifyDesc}>
            <Toggle
              checked={settings.newsNotify}
              onChange={(v) => void update({ newsNotify: v })}
              label={zhCN.settings.newsNotify}
            />
          </Row>
          <Row label={zhCN.settings.newsPoll}>
            <Select
              value={String(settings.newsPollSec)}
              options={[30, 60, 120, 300].map((v) => ({ value: String(v), label: `${v} ${zhCN.settings.intervalUnit}` }))}
              onChange={(v) => void update({ newsPollSec: Number(v) })}
            />
          </Row>
        </Section>

        <Section title={zhCN.settings.ai}>
          <Row label={zhCN.settings.aiEnable} desc={zhCN.settings.aiEnableDesc}>
            <Toggle
              checked={settings.aiEnabled}
              onChange={(v) => void update({ aiEnabled: v })}
              label={zhCN.settings.aiEnable}
            />
          </Row>
          <Row label={zhCN.settings.aiBaseURL}>
            <TextField
              value={settings.aiBaseURL}
              placeholder={zhCN.settings.aiBaseURLPlaceholder}
              onChange={(v) => void update({ aiBaseURL: v })}
            />
          </Row>
          <Row label={zhCN.settings.aiKey}>
            <TextField
              type="password"
              value={settings.aiKey}
              placeholder={zhCN.settings.aiKeyPlaceholder}
              onChange={(v) => void update({ aiKey: v })}
            />
          </Row>
          <Row label={zhCN.settings.aiModel}>
            <TextField
              value={settings.aiModel}
              placeholder={zhCN.settings.aiModelPlaceholder}
              onChange={(v) => void update({ aiModel: v })}
            />
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
