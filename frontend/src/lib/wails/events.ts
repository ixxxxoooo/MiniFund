/**
 * Go 侧事件订阅封装：事件名与载荷类型集中定义，
 * 与 internal/scheduler/scheduler.go 中的事件名保持一致。
 */
import { EventsOn } from "./runtime";
import type { FundEstimate, IndexQuote, MonitorState } from "@bindings/minifund/internal/model";

/**
 * 当日净值确认事件载荷。
 * 注意：该模型只出现在事件中（bindings 不生成），需与 internal/model/model.go 的 NavConfirmed 保持一致。
 */
export interface NavConfirmed {
  code: string;
  date: string;
  nav: number;
  growth: number;
  profit: number;
}

/** 数据源降级事件载荷 */
export interface DegradedPayload {
  source: string;
  degraded: boolean;
}

/** 订阅自选估值刷新（交易时段每 15-60s 推送） */
export function onEstimates(cb: (data: FundEstimate[]) => void): () => void {
  return EventsOn("fund:estimates", cb);
}

/** 订阅指数行情刷新 */
export function onIndexes(cb: (data: IndexQuote[]) => void): () => void {
  return EventsOn("market:indexes", cb);
}

/** 订阅当日净值确认 */
export function onNavConfirmed(cb: (data: NavConfirmed) => void): () => void {
  return EventsOn("fund:nav-confirmed", cb);
}

/** 订阅监控状态变化（时段切换/暂停恢复） */
export function onMonitorState(cb: (data: MonitorState) => void): () => void {
  return EventsOn("monitor:state", cb);
}

/** 订阅数据源降级状态 */
export function onDegraded(cb: (data: DegradedPayload) => void): () => void {
  return EventsOn("datasource:degraded", cb);
}

/** 订阅自选/持仓变更（任一窗口修改后所有窗口重新加载，保证主窗口与托盘同步） */
export function onWatchlistChanged(cb: () => void): () => void {
  return EventsOn("watchlist:changed", cb);
}

/** 订阅托盘面板弹出（面板每次显示时重新加载数据） */
export function onTrayPanelShown(cb: () => void): () => void {
  return EventsOn("traypanel:shown", cb);
}
