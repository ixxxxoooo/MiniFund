import { Application, Browser, Events, Window } from "@wailsio/runtime";

/** 订阅 Go 侧事件，返回取消订阅函数 */
export function EventsOn<T>(eventName: string, callback: (data: T) => void): () => void {
  return Events.On(eventName, (event) => {
    callback(event.data as T);
  });
}

/** 退出应用 */
export function Quit(): Promise<void> {
  return Application.Quit();
}

/** 用系统默认浏览器打开外部链接（如东方财富个股页） */
export function OpenExternalURL(url: string): Promise<void> {
  return Browser.OpenURL(url);
}

/** 最小化当前窗口 */
export function WindowMinimise(): Promise<void> {
  return Window.Minimise();
}

/** 切换当前窗口最大化状态 */
export async function WindowToggleMaximise(): Promise<void> {
  if (await Window.IsMaximised()) {
    await Window.Restore();
    return;
  }
  await Window.Maximise();
}
