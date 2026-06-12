import { create } from "zustand";
import { SettingsService } from "@bindings/minifund/services";
import { AppSettings } from "@bindings/minifund/services/models";
import { call } from "@/lib/wails/call";
import { useThemeStore } from "./theme";

/** 将设置应用到 DOM（紧凑模式 / 涨跌配色 / 主题） */
function applyAppearance(settings: AppSettings) {
  const root = document.documentElement;
  root.classList.toggle("compact", settings.compactMode);
  root.classList.toggle("scheme-intl", settings.quoteColorScheme === "intl");
  useThemeStore.getState().setTheme(settings.theme as "light" | "dark" | "system");
}

interface SettingsStore {
  /** 当前设置（加载完成前为 null） */
  settings: AppSettings | null;
  /** 从后端加载设置并应用外观 */
  load: () => Promise<void>;
  /** 局部更新设置：合并 → 持久化 → 应用外观 */
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  settings: null,

  load: async () => {
    const settings = await call("加载设置", () => SettingsService.Get());
    if (settings) {
      applyAppearance(settings);
      set({ settings });
    }
  },

  update: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = AppSettings.createFrom({ ...current, ...patch });
    const ok = await call("保存设置", () => SettingsService.Update(next));
    if (ok !== null) {
      applyAppearance(next);
      set({ settings: next });
    }
  },
}));
