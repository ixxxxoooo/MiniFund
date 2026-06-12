import { describe, expect, it } from "vitest";
import { formatMoney, formatNav, formatPercent, quoteDirection } from "./format";

describe("行情格式化工具", () => {
  it("涨跌方向判断", () => {
    expect(quoteDirection(1.24)).toBe("up");
    expect(quoteDirection(-0.5)).toBe("down");
    expect(quoteDirection(0)).toBe("flat");
  });

  it("涨跌幅格式化：涨带正号、跌带负号", () => {
    expect(formatPercent(1.24)).toBe("+1.24%");
    expect(formatPercent(-0.86)).toBe("-0.86%");
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("金额格式化：千分位与隐私模式", () => {
    expect(formatMoney(12345.678)).toBe("+¥12,345.68");
    expect(formatMoney(-100)).toBe("-¥100.00");
    expect(formatMoney(12345.678, true)).toBe("****");
  });

  it("净值保留 4 位小数", () => {
    expect(formatNav(1.2)).toBe("1.2000");
  });
});
