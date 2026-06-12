import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名（clsx + tailwind-merge） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
