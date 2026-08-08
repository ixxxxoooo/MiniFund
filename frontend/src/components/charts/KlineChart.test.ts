import { describe, expect, it } from "vitest";
import type { Kline } from "@bindings/minifund/internal/model";
import { createCandleTooltip, toKLineData } from "./kline-chart-utils";

describe("KlineChart", () => {
  it("将行情日期与当天涨幅传给图表浮窗", () => {
    const data = toKLineData([
      {
        date: "2026-08-07",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 1234,
        amount: 5678,
        changePercent: 2,
      } as Kline,
    ]);

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 1234,
      turnover: 5678,
      changePercent: 2,
      displayDate: "2026-08-07",
    });
    expect(Number.isFinite(data[0].timestamp)).toBe(true);
  });

  it("按涨跌方向格式化浮窗涨幅", () => {
    const tooltip = createCandleTooltip("上涨色", "下跌色", "平盘色", 120);
    const legends = tooltip({
      prev: null,
      current: {
        timestamp: Date.parse("2026-08-07T00:00:00"),
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        changePercent: 2,
        displayDate: "2026-08-07",
      },
      next: null,
    }, {} as never);

    expect(legends[1]).toEqual({
      title: "涨幅：",
      value: { text: "+2.00%", color: "上涨色" },
    });
    expect(legends[0]).toEqual({ title: "日期：", value: "2026-08-07" });
    expect(legends[2]).toEqual({
      title: "距今涨幅：",
      value: { text: "+17.65%", color: "上涨色" },
    });
  });
});
