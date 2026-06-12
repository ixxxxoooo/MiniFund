import { Application, Events, Window } from "@wailsio/runtime";

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
