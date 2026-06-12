import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { MainWindow } from "./windows/MainWindow";
import { TrayPanel } from "./windows/TrayPanel";
import { DetailWindow } from "./windows/DetailWindow";
// 引入主题 store 触发持久化恢复与系统主题监听
import "./stores/theme";

/**
 * 多窗口入口分发：前端为单一构建产物，
 * 各窗口通过 hash 路由渲染不同根组件（见 docs/TECH_DESIGN.md 6.1）。
 *   /#/main          主窗口
 *   /#/tray          托盘监控面板
 *   /#/detail/{code} 基金详情独立窗口
 */
function resolveWindow(): React.ReactElement {
  const hash = window.location.hash.replace(/^#\//, "");
  if (hash.startsWith("tray")) {
    return <TrayPanel />;
  }
  if (hash.startsWith("detail/")) {
    const code = hash.slice("detail/".length);
    return <DetailWindow code={code} />;
  }
  return <MainWindow />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{resolveWindow()}</React.StrictMode>
);
