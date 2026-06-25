export const locales = ["zh-CN", "en"] as const;
export const defaultLocale = "zh-CN";

export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}
