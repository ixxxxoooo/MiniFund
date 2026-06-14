/**
 * 持仓盈亏派生计算（前端口径，基于实时估值数据）。
 *
 * 当日收益口径（与 docs/PRD.md 2.3 一致，并补盘后兜底）：
 *   - 盘中（hasEstimate）：prevNav 为上一交易日净值，当日收益 = 份额 ×（估算净值 − 上一日净值）。
 *   - 已确认（hasDayGrowth）：调度器校正后 prevNav 即为最新已确认净值（今日净值），
 *     dayGrowth 为今日真实日涨幅；昨日净值 = prevNav ÷ (1 + dayGrowth/100)，
 *     当日收益 = 份额 ×（今日净值 − 昨日净值）。
 *   - 二者皆无（刚加入未取到行情）：当日收益与昨日市值记为缺失。
 */
import type { FundEstimate, Position, WatchItem } from "@bindings/minifund/internal/model";

/** 单只持仓的派生指标（无持仓或无行情时相关字段为 null） */
export interface PositionMetrics {
  /** 是否录入持仓 */
  hasPosition: boolean;
  /** 最新净值（盘中估算 / 盘后已确认；无行情为 null） */
  latestNav: number | null;
  /** 持仓市值 */
  marketValue: number | null;
  /** 当日收益（金额） */
  todayProfit: number | null;
  /** 昨日市值（当日收益率分母） */
  prevValue: number | null;
  /** 累计收益（金额） */
  totalProfit: number | null;
  /** 累计收益率（%） */
  totalPercent: number | null;
  /** 持仓成本（份额 × 成本价） */
  costValue: number | null;
}

const EMPTY: PositionMetrics = {
  hasPosition: false,
  latestNav: null,
  marketValue: null,
  todayProfit: null,
  prevValue: null,
  totalProfit: null,
  totalPercent: null,
  costValue: null,
};

/** 计算单只基金的持仓派生指标 */
export function computePositionMetrics(est?: FundEstimate, pos?: Position): PositionMetrics {
  if (!pos) return EMPTY;
  if (!est || est.prevNav <= 0) return { ...EMPTY, hasPosition: true };

  // 最新净值：盘中用估算净值；盘后/已确认时 prevNav 经调度器校正即为最新净值
  const latestNav = est.hasEstimate ? est.estimate : est.prevNav;
  const marketValue = pos.shares * latestNav;

  let todayProfit: number | null = null;
  let prevValue: number | null = null;
  if (est.hasEstimate) {
    prevValue = pos.shares * est.prevNav;
    todayProfit = pos.shares * (est.estimate - est.prevNav);
  } else if (est.hasDayGrowth) {
    const prevDayNav = est.prevNav / (1 + est.dayGrowth / 100);
    prevValue = pos.shares * prevDayNav;
    todayProfit = marketValue - prevValue;
  }

  const costValue = pos.shares * pos.costPrice;
  const totalProfit = marketValue - costValue;
  const totalPercent = costValue > 0 ? (totalProfit / costValue) * 100 : null;

  return { hasPosition: true, latestNav, marketValue, todayProfit, prevValue, totalProfit, totalPercent, costValue };
}

/** 分组持仓汇总 */
export interface GroupSummary {
  /** 持仓总市值 */
  marketValue: number;
  /** 当日预估总收益（金额） */
  todayProfit: number;
  /** 当日预估收益率（%） */
  todayPercent: number;
  /** 累计收益（金额） */
  totalProfit: number;
  /** 累计收益率（%） */
  totalPercent: number;
  /** 持仓总成本 */
  costValue: number;
  /** 有持仓且有行情的基金数 */
  positionCount: number;
}

/**
 * 汇总当前分组下「有持仓」的基金指标。
 * 严格按传入的 items（当前分组条目）统计，分组间互相隔离。
 */
export function computeGroupSummary(
  items: WatchItem[],
  positions: Record<string, Position>,
  estimates: Record<string, FundEstimate>
): GroupSummary {
  let marketValue = 0;
  let todayProfit = 0;
  let prevValue = 0;
  let totalProfit = 0;
  let costValue = 0;
  let positionCount = 0;

  for (const it of items) {
    const m = computePositionMetrics(estimates[it.code], positions[it.code]);
    if (!m.hasPosition || m.marketValue == null) continue;
    positionCount += 1;
    marketValue += m.marketValue;
    if (m.todayProfit != null) todayProfit += m.todayProfit;
    if (m.prevValue != null) prevValue += m.prevValue;
    if (m.totalProfit != null) totalProfit += m.totalProfit;
    if (m.costValue != null) costValue += m.costValue;
  }

  const todayPercent = prevValue > 0 ? (todayProfit / prevValue) * 100 : 0;
  const totalPercent = costValue > 0 ? (totalProfit / costValue) * 100 : 0;
  return { marketValue, todayProfit, todayPercent, totalProfit, totalPercent, costValue, positionCount };
}
