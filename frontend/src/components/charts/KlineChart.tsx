import { useEffect, useRef } from "react";
import {
  init,
  dispose,
  type Chart,
  type KLineData,
  type DeepPartial,
  type Styles,
} from "klinecharts";
import type { Kline } from "@bindings/minifund/internal/model";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";

interface KlineChartProps {
  /** K 线数据（按日期升序） */
  data: Kline[];
  /** 是否还有更早历史可加载（向左滚动触发 onLoadMore） */
  more: boolean;
  /** 重置标识（如 secid|period）；变化时整段重绘并复位视图 */
  resetKey: string;
  /** 图表总高度（px） */
  height: number;
  /** 向左滚动到最左侧时加载更多历史，返回新增的更早切片与是否仍有更多 */
  onLoadMore: () => Promise<{ older: Kline[]; more: boolean }>;
}

/** 读取一组 CSS 变量的当前计算值（随主题/涨跌色方案自动解析为具体颜色）。 */
function readTokens(names: string[]): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  return out;
}

/** 将领域模型 Kline 转换为 klinecharts 数据（日期字符串转毫秒时间戳，成交额映射 turnover）。 */
function toKLineData(list: Kline[]): KLineData[] {
  return list.map((k) => ({
    timestamp: new Date(`${k.date.replace(" ", "T")}${k.date.length <= 10 ? "T00:00:00" : ""}`).getTime(),
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    turnover: k.amount,
  }));
}

/**
 * 构建 klinecharts 主题样式：颜色全部来自 globals.css 的主题 token，
 * 自动跟随明/暗主题与涨跌色方案；摸鱼模式下涨跌统一为平盘中性色，不暴露涨跌。
 */
function buildStyles(stealth: boolean): DeepPartial<Styles> {
  const t = readTokens([
    "--quote-up",
    "--quote-down",
    "--fg-secondary", // 平盘色（--quote-flat 实为 var(--fg-secondary)，getComputedStyle 不展开引用，直接读底色）
    "--border-color",
    "--fg-muted",
    "--surface-elevated",
    "--accent",
    "--warning",
    "--info",
  ]);
  const up = stealth ? t["--fg-secondary"] : t["--quote-up"];
  const down = stealth ? t["--fg-secondary"] : t["--quote-down"];
  const flat = t["--fg-secondary"];
  const grid = t["--border-color"];
  const axisText = t["--fg-muted"];
  const tooltipBg = t["--surface-elevated"];
  const tooltipText = t["--fg-secondary"];

  const change = { upColor: up, downColor: down, noChangeColor: flat };

  return {
    grid: {
      horizontal: { color: grid },
      vertical: { color: grid },
    },
    candle: {
      bar: {
        ...change,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: flat,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: flat,
      },
      priceMark: {
        high: { color: axisText },
        low: { color: axisText },
        last: {
          ...change,
          text: { color: tooltipBg },
        },
      },
      tooltip: {
        text: { color: tooltipText },
        rect: { color: tooltipBg, borderColor: grid },
      },
    },
    indicator: {
      // MA5/MA10/MA20 线色沿用界面强调/警告/信息色
      lines: [{ color: t["--accent"] }, { color: t["--warning"] }, { color: t["--info"] }],
      // 量能柱跟随涨跌色（摸鱼下中性）
      bars: [change],
      tooltip: { text: { color: tooltipText } },
    },
    xAxis: {
      axisLine: { color: grid },
      tickLine: { color: grid },
      tickText: { color: axisText },
    },
    yAxis: {
      axisLine: { color: grid },
      tickLine: { color: grid },
      tickText: { color: axisText },
    },
    separator: { color: grid },
    crosshair: {
      horizontal: {
        line: { color: axisText },
        text: { color: tooltipBg, backgroundColor: tooltipText, borderColor: tooltipText },
      },
      vertical: {
        line: { color: axisText },
        text: { color: tooltipBg, backgroundColor: tooltipText, borderColor: tooltipText },
      },
    },
  };
}

/**
 * 行情中心 K 线图（基于 klinecharts）：内置缩放、滚动、拖拽平移与十字光标；
 * 向左滚动到最左侧时通过 onLoadMore 动态加载更多历史，配合后端 SQLite 长期缓存秒开。
 * 样式映射主题 token，随明暗主题/涨跌色方案/摸鱼模式实时切换。
 */
export function KlineChart({ data, more, resetKey, height, onLoadMore }: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const appliedKeyRef = useRef<string>("");
  const loadingMoreRef = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const resolved = useThemeStore((s) => s.resolved);
  const stealth = useSettingsStore((s) => s.settings?.stealthMode ?? false);
  const scheme = useSettingsStore((s) => s.settings?.quoteColorScheme ?? "cn");

  // 初始化与销毁（仅一次）：创建实例、MA/VOL 指标、注册 loadMore 回调。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el);
    chartRef.current = chart;
    if (chart) {
      chart.createIndicator({ name: "MA", calcParams: [5, 10, 20] }, true, { id: "candle_pane" });
      chart.createIndicator("VOL", false, { id: "vol_pane" });
      chart.setStyles(buildStyles(stealth));
      // 收窄最新 K 线到右侧价格轴的默认预留间距（库默认偏大，会显示一段空白）。
      chart.setOffsetRightDistance(4);
      chart.loadMore(() => {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        void onLoadMoreRef.current()
          .then(({ older, more: hasMore }) => {
            chartRef.current?.applyMoreData(toKLineData(older), hasMore);
          })
          .finally(() => {
            loadingMoreRef.current = false;
          });
      });
    }
    return () => {
      if (el) dispose(el);
      chartRef.current = null;
      appliedKeyRef.current = "";
    };
    // 仅挂载时执行；样式与数据由后续独立 effect 维护。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据更新：切换指数/周期（resetKey 变化）时整段重绘并复位视图；
  // 同一 resetKey 下的数据增长来自 loadMore（已用 applyMoreData 前插），此处跳过避免重置视图。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;
    if (appliedKeyRef.current !== resetKey) {
      appliedKeyRef.current = resetKey;
      chart.applyNewData(toKLineData(data), more);
    }
  }, [data, more, resetKey]);

  // 主题/涨跌色方案/摸鱼模式变化时重应用样式。
  useEffect(() => {
    chartRef.current?.setStyles(buildStyles(stealth));
  }, [resolved, stealth, scheme]);

  // 高度变化时通知图表重新测量。
  useEffect(() => {
    chartRef.current?.resize();
  }, [height]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
