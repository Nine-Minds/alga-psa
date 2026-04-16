export const SUPPORTED_LOCALES = ["en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const NAMESPACES = ["common", "auth", "tickets", "settings", "iap"] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NS: Namespace = "common";
