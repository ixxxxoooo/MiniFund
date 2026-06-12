/** 中文文案集中管理（v1 仅中文，预留 i18n 结构） */
export const zhCN = {
  app: {
    name: "MiniFund",
    slogan: "基金监控桌面工具",
  },
  main: {
    searchPlaceholder: "搜索基金（代码 / 名称 / 拼音）",
    watchlistEmpty: "还没有自选基金",
    watchlistEmptyAction: "搜索添加第一只基金",
    skeletonNotice: "项目骨架已就绪，功能开发见 docs/ROADMAP.md",
  },
  tray: {
    panelTitle: "今日监控",
    openMain: "打开主窗口",
    todayProfit: "当日预估收益",
  },
  detail: {
    loading: "加载基金详情…",
  },
} as const;
