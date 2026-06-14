/**
 * Go 侧事件订阅封装：事件名与载荷类型集中定义，
 * 与 internal/scheduler/scheduler.go 中的事件名保持一致。
 */
import { EventsOn } from "./runtime";
import type { FundEstimate, IndexQuote, MarketIndexQuote, MonitorState, NewsFlash } from "@bindings/minifund/internal/model";

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

/** 订阅行情中心指数刷新（调度器每 30s 主动推送 A股/港股/美股/韩国清单，全天候） */
export function onMarketCenter(cb: (data: MarketIndexQuote[]) => void): () => void {
  return EventsOn("market:center", cb);
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

/** 订阅财经快讯刷新（调度器定时拉取后推送最新快讯列表） */
export function onNewsFlash(cb: (data: NewsFlash[]) => void): () => void {
  return EventsOn("news:flash", cb);
}

/** AI 流式累计全文载荷（每次推送均为「截至当前的完整文本」，前端取最长即可，免疫乱序） */
export interface AIChunkPayload {
  id: string;
  text: string;
}

/** AI 流式完成载荷 */
export interface AIDonePayload {
  id: string;
}

/** AI 流式错误载荷 */
export interface AIErrorPayload {
  id: string;
  message: string;
}

/** 订阅 AI 解读增量（调用方按 streamID 过滤归属） */
export function onAIChunk(cb: (data: AIChunkPayload) => void): () => void {
  return EventsOn("ai:chunk", cb);
}

/** 订阅 AI 解读完成 */
export function onAIDone(cb: (data: AIDonePayload) => void): () => void {
  return EventsOn("ai:done", cb);
}

/** 订阅 AI 解读错误 */
export function onAIError(cb: (data: AIErrorPayload) => void): () => void {
  return EventsOn("ai:error", cb);
}
