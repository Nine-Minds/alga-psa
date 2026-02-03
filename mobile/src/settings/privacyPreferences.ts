import { secureStorage } from "../storage/secureStorage";

const HIDE_SENSITIVE_NOTIFICATIONS_KEY = "alga.mobile.settings.hideSensitiveNotifications";

export async function getHideSensitiveNotificationsEnabled(): Promise<boolean> {
  const value = await secureStorage.getItem(HIDE_SENSITIVE_NOTIFICATIONS_KEY);
  return value === "1";
}

export async function setHideSensitiveNotificationsEnabled(enabled: boolean): Promise<void> {
  await secureStorage.setItem(HIDE_SENSITIVE_NOTIFICATIONS_KEY, enabled ? "1" : "0");
}

