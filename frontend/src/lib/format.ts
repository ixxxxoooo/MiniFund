/** 行情数据格式化工具：所有涨跌幅/金额展示必须经过这里，保证格式统一 */

/** 涨跌方向 */
export type QuoteDirection = "up" | "down" | "flat";

/** 判断数值的涨跌方向 */
export function quoteDirection(value: number): QuoteDirection {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/**
 * 格式化涨跌幅百分比：涨带 +、跌带 -、平为 0.00%
 * @param value 涨跌幅数值（如 1.24 表示 1.24%）
 * @param digits 小数位数，默认 2
 */
export function formatPercent(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * 格式化金额：千分位分隔，保留 2 位小数
 * @param value 金额数值
 * @param hidden 隐私模式下隐藏金额
 */
export function formatMoney(value: number, hidden = false): string {
  if (hidden) return "****";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}¥${abs.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 格式化净值：保留 4 位小数（基金净值惯例） */
export function formatNav(value: number): string {
  return value.toFixed(4);
}
