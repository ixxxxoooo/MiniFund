import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DCAPlan, type PositionTxn, type WatchItem } from "@bindings/minifund/internal/model";
import { PortfolioService } from "@bindings/minifund/services";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QuoteText } from "@/components/market/QuoteText";
import { zhCN } from "@/i18n/zh-CN";
import { formatMoney, formatNav } from "@/lib/format";
import { computePositionMetrics } from "@/lib/portfolio";
import { call } from "@/lib/wails/call";
import { useMarketStore } from "@/stores/market";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useWatchlistStore } from "@/stores/watchlist";

interface PositionDialogProps {
  /** 正在编辑持仓的自选条目，null 表示关闭 */
  item: WatchItem | null;
  onClose: () => void;
}

/** 返回本地今日日期 yyyy-MM-dd */
function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const t = zhCN.position;
const td = zhCN.dca;

/**
 * 持仓管理对话框：三段式——持仓概览（只读派生）/ 交易流水（加删，回车提交）/ 定投计划。
 * 持仓份额与成本由交易流水移动加权重算，计算口径见 docs/PRD.md 2.3。
 */
export function PositionDialog({ item, onClose }: PositionDialogProps) {
  const positions = useWatchlistStore((s) => s.positions);
  const savePosition = useWatchlistStore((s) => s.savePosition);
  const deletePosition = useWatchlistStore((s) => s.deletePosition);
  const addTransaction = useWatchlistStore((s) => s.addTransaction);
  const deleteTransaction = useWatchlistStore((s) => s.deleteTransaction);
  const upsertDCAPlan = useWatchlistStore((s) => s.upsertDCAPlan);
  const deleteDCAPlan = useWatchlistStore((s) => s.deleteDCAPlan);
  const setDCAPlanEnabled = useWatchlistStore((s) => s.setDCAPlanEnabled);
  const estimate = useMarketStore((s) => (item ? s.estimates[item.code] : undefined));
  // 隐藏金额/摸鱼模式：持仓概览的金额与收益需响应全局隐私开关，不能明文暴露
  const hideAmounts = useUIStore((s) => s.hideAmounts);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const hidden = hideAmounts || stealth;

  const [txns, setTxns] = useState<PositionTxn[]>([]);
  const [plans, setPlans] = useState<DCAPlan[]>([]);

  // 快速记一笔
  const [txnKind, setTxnKind] = useState("buy");
  const [txnDate, setTxnDate] = useState(todayStr());
  const [txnShares, setTxnShares] = useState("");
  const [txnPrice, setTxnPrice] = useState("");
  const [txnError, setTxnError] = useState("");

  // 基准持仓（直接设定份额/成本）
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [baseError, setBaseError] = useState("");

  // 定投计划编辑
  const [planOpen, setPlanOpen] = useState(false);
  const [planId, setPlanId] = useState(0);
  const [planFreq, setPlanFreq] = useState("monthly");
  const [planDay, setPlanDay] = useState("1");
  const [planAmount, setPlanAmount] = useState("");
  const [planAuto, setPlanAuto] = useState(false);
  const [planError, setPlanError] = useState("");

  // 待删除的交易流水 id（应用内确认弹窗，替代 Wails WebView 不支持的 window.confirm）
  const [deleteTxnId, setDeleteTxnId] = useState<number | null>(null);

  const code = item?.code ?? "";
  const existing = item ? positions[code] : undefined;
  const metrics = computePositionMetrics(estimate, existing);

  const reload = useCallback(async () => {
    if (!code) return;
    const [txnList, planList] = await Promise.all([
      call("加载交易流水", () => PortfolioService.ListTransactions(code)),
      call("加载定投计划", () => PortfolioService.ListDCAPlans()),
    ]);
    setTxns(txnList ?? []);
    setPlans((planList ?? []).filter((p) => p.code === code));
  }, [code]);

  // 打开时加载流水/计划并回填基准表单
  useEffect(() => {
    if (!item) return;
    setShares(existing ? String(existing.shares) : "");
    setCost(existing ? String(existing.costPrice) : "");
    setTxnKind("buy");
    setTxnDate(todayStr());
    setTxnShares("");
    setTxnPrice("");
    setTxnError("");
    setBaseError("");
    setPlanOpen(false);
    void reload();
    // existing 仅用于初始回填，故不纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, reload]);

  const handleAddTxn = async () => {
    const sh = parseFloat(txnShares);
    const pr = parseFloat(txnPrice);
    if (!code || !(sh > 0) || !(pr > 0)) {
      setTxnError(t.txnInvalid);
      return;
    }
    const ok = await addTransaction(code, txnDate || todayStr(), txnKind, sh, pr, "");
    if (ok) {
      setTxnShares("");
      setTxnPrice("");
      setTxnError("");
      await reload();
    }
  };

  const handleDeleteTxn = (id: number) => {
    setDeleteTxnId(id);
  };

  const handleSaveBaseline = async () => {
    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(cost);
    if (!item || !(sharesNum > 0) || !(costNum > 0)) {
      setBaseError(t.invalid);
      return;
    }
    await savePosition(code, sharesNum, costNum);
    await reload();
    setBaseError("");
  };

  const handleDeletePosition = async () => {
    if (!item) return;
    await deletePosition(code);
    onClose();
  };

  const openNewPlan = () => {
    setPlanId(0);
    setPlanFreq("monthly");
    setPlanDay("1");
    setPlanAmount("");
    setPlanAuto(false);
    setPlanError("");
    setPlanOpen(true);
  };

  const openEditPlan = (p: DCAPlan) => {
    setPlanId(p.id);
    setPlanFreq(p.freq);
    setPlanDay(String(p.day));
    setPlanAmount(String(p.amount));
    setPlanAuto(p.autoRecord);
    setPlanError("");
    setPlanOpen(true);
  };

  const handleSavePlan = async () => {
    const amount = parseFloat(planAmount);
    if (!(amount > 0)) {
      setPlanError(td.invalid);
      return;
    }
    const plan = new DCAPlan({
      id: planId,
      code,
      freq: planFreq,
      day: parseInt(planDay, 10) || 1,
      amount,
      autoRecord: planAuto,
      enabled: true,
    });
    if (await upsertDCAPlan(plan)) {
      setPlanOpen(false);
      await reload();
    }
  };

  const handleDeletePlan = async (id: number) => {
    if (await deleteDCAPlan(id)) await reload();
  };

  const handleTogglePlan = async (p: DCAPlan) => {
    if (await setDCAPlanEnabled(p.id, !p.enabled)) await reload();
  };

  const planDayLabel = (p: DCAPlan) =>
    p.freq === "weekly" ? (td.week[p.day - 1] ?? `周${p.day}`) : `${p.day}${td.monthDaySuffix}`;

  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[600px] max-h-[86vh] overflow-y-auto">
        <DialogTitle>
          {t.title}
          {item && (
            <span className="ml-2 text-[length:var(--size-font-xs)] font-normal text-[var(--fg-secondary)]">
              {item.name} <span className="quote-num">{item.code}</span>
            </span>
          )}
        </DialogTitle>

        {/* 一、持仓概览 */}
        <section className="mb-4">
          <h3 className="mb-2 text-[length:var(--size-font-xs)] font-semibold text-[var(--fg-secondary)]">{t.overview}</h3>
          {metrics.hasPosition && existing ? (
            <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--surface)] p-3">
              <Stat label={t.totalShares} value={existing.shares.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} />
              <Stat label={t.avgCost} value={formatNav(existing.costPrice)} />
              <Stat label={t.costValue} value={formatMoney(metrics.costValue ?? existing.shares * existing.costPrice, hidden)} />
              <Stat label={t.marketValue} value={metrics.marketValue != null ? formatMoney(metrics.marketValue, hidden) : "—"} />
              <div className="flex flex-col gap-0.5">
                <span className="text-2xs text-[var(--fg-muted)]">{t.totalProfit}</span>
                {metrics.totalProfit != null ? (
                  <QuoteText
                    value={metrics.totalProfit}
                    neutral={stealth}
                    text={`${formatMoney(metrics.totalProfit, hidden)}${metrics.totalPercent != null ? ` (${metrics.totalPercent >= 0 ? "+" : ""}${metrics.totalPercent.toFixed(2)}%)` : ""}`}
                    className="text-[length:var(--size-font-sm)]"
                  />
                ) : (
                  <span className="text-[length:var(--size-font-sm)] text-[var(--fg)]">—</span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-color)] p-3 text-center text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">
              {t.noPosition}
            </div>
          )}
        </section>

        {/* 二、交易流水 */}
        <section className="mb-4">
          <h3 className="mb-2 text-[length:var(--size-font-xs)] font-semibold text-[var(--fg-secondary)]">{t.txnTitle}</h3>
          {txns.length > 0 && (
            <div className="mb-2 max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-color)]">
              <table className="w-full text-[length:var(--size-font-xs)]">
                <thead className="sticky top-0 bg-[var(--surface-secondary)] text-[var(--fg-muted)]">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">{t.date}</th>
                    <th className="px-2 py-1 text-left font-normal">{t.kind}</th>
                    <th className="px-2 py-1 text-right font-normal">{t.shares}</th>
                    <th className="px-2 py-1 text-right font-normal">{t.price}</th>
                    <th className="px-2 py-1 text-right font-normal">{t.amount}</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {txns.map((x) => (
                    <tr key={x.id} className="border-t border-[var(--border-color)] text-[var(--fg)]">
                      <td className="px-2 py-1">{x.date}</td>
                      <td className="px-2 py-1">
                        <span className={x.kind === "sell" ? "text-[var(--quote-down)]" : "text-[var(--quote-up)]"}>
                          {x.kind === "sell" ? t.sell : t.buy}
                        </span>
                        {x.source === "dca" && <span className="ml-1 text-2xs text-[var(--fg-muted)]">{td.title}</span>}
                      </td>
                      <td className="px-2 py-1 text-right quote-num">{x.shares.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1 text-right quote-num">{formatNav(x.price)}</td>
                      <td className="px-2 py-1 text-right quote-num">{x.amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          className="text-[var(--fg-muted)] hover:text-[var(--danger)]"
                          onClick={() => void handleDeleteTxn(x.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 快速记一笔（回车提交） */}
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t.date}>
              <Input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="w-[130px]" />
            </Field>
            <Field label={t.kind}>
              <select
                value={txnKind}
                onChange={(e) => setTxnKind(e.target.value)}
                className="h-[var(--size-input)] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-sm)] text-[var(--fg)]"
              >
                <option value="buy">{t.buy}</option>
                <option value="sell">{t.sell}</option>
              </select>
            </Field>
            <Field label={t.shares}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={txnShares}
                onChange={(e) => setTxnShares(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddTxn()}
                placeholder={t.sharesPlaceholder}
                className="w-[110px]"
              />
            </Field>
            <Field label={t.price}>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={txnPrice}
                onChange={(e) => setTxnPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddTxn()}
                placeholder={t.pricePlaceholder}
                className="w-[100px]"
              />
            </Field>
            <Button size="sm" onClick={() => void handleAddTxn()}>
              {t.add}
            </Button>
          </div>
          {txnError && <div className="mt-1 text-2xs text-[var(--danger)]">{txnError}</div>}
        </section>

        {/* 三、定投计划 */}
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[length:var(--size-font-xs)] font-semibold text-[var(--fg-secondary)]">{td.title}</h3>
            {!planOpen && (
              <Button variant="outline" size="sm" onClick={openNewPlan}>
                {td.add}
              </Button>
            )}
          </div>

          {plans.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--surface)] px-3 py-1.5 text-[length:var(--size-font-xs)]"
                >
                  <div className="flex items-center gap-2 text-[var(--fg)]">
                    <span>{p.freq === "weekly" ? td.weekly : td.monthly}</span>
                    <span className="text-[var(--fg-secondary)]">{planDayLabel(p)}</span>
                    <span className="quote-num">{formatMoney(p.amount)}</span>
                    {p.autoRecord && <span className="text-2xs text-[var(--accent)]">{td.autoRecord}</span>}
                    {p.nextRun && <span className="text-2xs text-[var(--fg-muted)]">{td.nextRun} {p.nextRun}</span>}
                    {!p.enabled && <span className="text-2xs text-[var(--fg-muted)]">（停用）</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => void handleTogglePlan(p)}>
                      {p.enabled ? "停用" : "启用"}
                    </button>
                    <button className="text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => openEditPlan(p)}>
                      编辑
                    </button>
                    <button className="text-[var(--fg-muted)] hover:text-[var(--danger)]" onClick={() => void handleDeletePlan(p.id)}>
                      {td.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {plans.length === 0 && !planOpen && (
            <div className="text-[length:var(--size-font-xs)] text-[var(--fg-muted)]">{td.empty}</div>
          )}

          {planOpen && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={td.freq}>
                  <select
                    value={planFreq}
                    onChange={(e) => {
                      setPlanFreq(e.target.value);
                      setPlanDay("1");
                    }}
                    className="h-[var(--size-input)] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-sm)] text-[var(--fg)]"
                  >
                    <option value="weekly">{td.weekly}</option>
                    <option value="monthly">{td.monthly}</option>
                  </select>
                </Field>
                <Field label={td.day}>
                  <select
                    value={planDay}
                    onChange={(e) => setPlanDay(e.target.value)}
                    className="h-[var(--size-input)] rounded-[var(--radius-input)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-sm)] text-[var(--fg)]"
                  >
                    {planFreq === "weekly"
                      ? td.week.map((w, i) => (
                          <option key={i} value={i + 1}>
                            {w}
                          </option>
                        ))
                      : Array.from({ length: 28 }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {i + 1}
                            {td.monthDaySuffix}
                          </option>
                        ))}
                  </select>
                </Field>
                <Field label={td.amount}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={planAmount}
                    onChange={(e) => setPlanAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleSavePlan()}
                    placeholder={td.amountPlaceholder}
                    className="w-[120px]"
                  />
                </Field>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[length:var(--size-font-xs)] text-[var(--fg-secondary)]">
                <input type="checkbox" checked={planAuto} onChange={(e) => setPlanAuto(e.target.checked)} />
                {td.autoRecord}
              </label>
              <p className="mt-1 text-2xs text-[var(--fg-muted)]">{td.autoHint}</p>
              {planError && <div className="mt-1 text-2xs text-[var(--danger)]">{planError}</div>}
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPlanOpen(false)}>
                  {td.cancel}
                </Button>
                <Button size="sm" onClick={() => void handleSavePlan()}>
                  {td.save}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 基准持仓（手动覆盖） */}
        <section className="border-t border-[var(--border-color)] pt-3">
          <h3 className="mb-1 text-[length:var(--size-font-xs)] font-semibold text-[var(--fg-secondary)]">{t.baselineTitle}</h3>
          <p className="mb-2 text-2xs text-[var(--fg-muted)]">{t.baselineHint}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t.shares}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSaveBaseline()}
                placeholder={t.sharesPlaceholder}
                className="w-[130px]"
              />
            </Field>
            <Field label={t.costPrice}>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSaveBaseline()}
                placeholder={t.costPlaceholder}
                className="w-[120px]"
              />
            </Field>
            <Button size="sm" onClick={() => void handleSaveBaseline()}>
              {t.save}
            </Button>
          </div>
          {baseError && <div className="mt-1 text-2xs text-[var(--danger)]">{baseError}</div>}

          <div className="mt-3 flex items-center justify-between">
            {existing ? (
              <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => void handleDeletePosition()}>
                {t.delete}
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
          </div>
        </section>
      </DialogContent>
      <ConfirmDialog
        open={deleteTxnId != null}
        title={t.confirmDeleteTxn}
        message={t.confirmDeleteTxn}
        confirmLabel="删除"
        danger
        onConfirm={async () => {
          const id = deleteTxnId;
          setDeleteTxnId(null);
          if (id != null && (await deleteTransaction(id))) await reload();
        }}
        onCancel={() => setDeleteTxnId(null)}
      />
    </Dialog>
  );
}

/** 概览统计项 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs text-[var(--fg-muted)]">{label}</span>
      <span className="text-[length:var(--size-font-sm)] text-[var(--fg)] quote-num">{value}</span>
    </div>
  );
}

/** 带标签的表单字段 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs text-[var(--fg-muted)]">
      {label}
      {children}
    </label>
  );
}
