import { logger, redact } from "../logging/logger";

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export type Analytics = {
  setEnabled(enabled: boolean): void;
  trackScreen(name: string, properties?: AnalyticsProperties): void;
  trackEvent(name: string, properties?: AnalyticsProperties): void;
};

function parseEnabled(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "true";
}

let enabled = parseEnabled(process.env.EXPO_PUBLIC_ANALYTICS_ENABLED);

export const analytics: Analytics = {
  setEnabled(next) {
    enabled = next;
  },
  trackScreen(name, properties) {
    if (!enabled) return;
    logger.info("analytics.screen", redact({ name, properties }));
  },
  trackEvent(name, properties) {
    if (!enabled) return;
    logger.info("analytics.event", redact({ name, properties }));
  },
};

