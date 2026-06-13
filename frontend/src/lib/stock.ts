/**
 * 根据持仓股票代码推断东方财富个股行情页地址。
 * 规则：
 * - 含字母：美股 -> us/{代码大写}
 * - 5 位纯数字：港股 -> hk/{代码}
 * - 6 位纯数字：A 股，按首位判断交易所（6=沪 / 0、3=深 / 4、8=北交所）
 * 无法判断时返回空字符串（前端据此不渲染为链接）。
 */
export function eastmoneyStockURL(code: string): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  if (/[A-Za-z]/.test(c)) {
    return `https://quote.eastmoney.com/us/${c.toUpperCase()}.html`;
  }
  if (/^\d{5}$/.test(c)) {
    return `https://quote.eastmoney.com/hk/${c}.html`;
  }
  if (/^\d{6}$/.test(c)) {
    const head = c[0];
    if (head === "6") return `https://quote.eastmoney.com/sh${c}.html`;
    if (head === "0" || head === "3") return `https://quote.eastmoney.com/sz${c}.html`;
    if (head === "4" || head === "8") return `https://quote.eastmoney.com/bj/${c}.html`;
    return `https://quote.eastmoney.com/sz${c}.html`;
  }
  return "";
}
