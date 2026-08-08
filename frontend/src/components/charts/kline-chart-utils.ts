import type { CandleTooltipCustomCallback, KLineData } from "klinecharts";
import type { Kline } from "@bindings/minifund/internal/model";

/**
 * 将日期字符串解析为毫秒时间戳。
 * 兼容纯日期与带时分的日期，解析失败时返回 NaN 供调用方过滤。
 */
function parseKlineDate(date: string): number {
  const value = date.trim();
  if (!value) return NaN;
  if (value.includes(" ")) return Date.parse(value.replace(" ", "T"));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00`);
  return Date.parse(value);
}

/** 将领域模型 Kline 转换为图表数据，并保留后端计算的当天涨幅。 */
export function toKLineData(list: Kline[]): KLineData[] {
  const result: KLineData[] = [];
  for (const item of list) {
    const timestamp = parseKlineDate(item.date);
    if (!Number.isFinite(timestamp)) continue;
    result.push({
      timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      turnover: item.amount,
      changePercent: item.changePercent,
      displayDate: item.date,
    });
  }
  return result;
}

/** 构建跟随十字光标的行情浮窗，涨幅优先使用后端已计算口径。 */
export function createCandleTooltip(
  up: string,
  down: string,
  flat: string,
  latestPrice: number,
): CandleTooltipCustomCallback {
  return ({ current }) => {
    const changePercent = Number(current.changePercent);
    const hasChange = Number.isFinite(changePercent);
    const changeColor = !hasChange || changePercent === 0 ? flat : changePercent > 0 ? up : down;
    const changeText = hasChange
      ? `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`
      : "—";
    const basePrice = Number(current.close);
    const hasDistanceGain = Number.isFinite(latestPrice) && latestPrice > 0 && Number.isFinite(basePrice) && basePrice > 0;
    const distanceGain = hasDistanceGain ? (latestPrice / basePrice - 1) * 100 : NaN;
    const distanceColor = !Number.isFinite(distanceGain) || distanceGain === 0
      ? flat
      : distanceGain > 0
        ? up
        : down;
    const distanceText = Number.isFinite(distanceGain)
      ? `${distanceGain > 0 ? "+" : ""}${distanceGain.toFixed(2)}%`
      : "—";

    return [
      { title: "日期：", value: String(current.displayDate ?? "—") },
      { title: "涨幅：", value: { text: changeText, color: changeColor } },
      { title: "距今涨幅：", value: { text: distanceText, color: distanceColor } },
      { title: "今开：", value: "{open}" },
      { title: "最高：", value: "{high}" },
      { title: "最低：", value: "{low}" },
      { title: "收盘：", value: "{close}" },
      { title: "成交量：", value: "{volume}" },
    ];
  };
}
