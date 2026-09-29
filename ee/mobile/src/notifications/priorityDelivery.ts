import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import i18n from "../i18n/i18n";

export type NotificationPriority = "high" | "normal" | "low";

/** Android channel ids the server addresses per priority (expoPushService). */
export const PRIORITY_CHANNEL_IDS: Record<NotificationPriority, string> = {
  high: "alga-priority-high",
  normal: "alga-priority-normal",
  low: "alga-priority-low",
};

export function asNotificationPriority(value: unknown): NotificationPriority {
  return value === "high" || value === "low" ? value : "normal";
}

/**
 * How a push should surface while the app is in the foreground. High
 * priority interrupts (banner + sound); normal is handled by the in-app
 * toast; low only touches the badge.
 */
export function foregroundBehaviorFor(priority: NotificationPriority): Notifications.NotificationBehavior {
  const interrupt = priority === "high";
  return {
    shouldShowAlert: interrupt,
    shouldPlaySound: interrupt,
    shouldSetBadge: true,
    shouldShowBanner: interrupt,
    shouldShowList: priority !== "low",
  };
}

/** Whether the in-app toast should announce a foreground push of this priority. */
export function shouldToastInForeground(priority: NotificationPriority): boolean {
  return priority !== "low";
}

let channelsEnsured = false;

/** Create the per-priority Android channels the server targets. Idempotent. */
export async function ensurePriorityChannels(): Promise<void> {
  if (Platform.OS !== "android" || channelsEnsured) return;
  const t = (key: string, defaultValue: string) => i18n.t(`settings:notifications.channels.${key}`, { defaultValue });
  await Promise.all([
    Notifications.setNotificationChannelAsync(PRIORITY_CHANNEL_IDS.high, {
      name: t("high", "High priority"),
      description: t("highDescription", "SLA breaches, escalations, and other urgent alerts."),
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    }),
    Notifications.setNotificationChannelAsync(PRIORITY_CHANNEL_IDS.normal, {
      name: t("normal", "Normal priority"),
      description: t("normalDescription", "Ticket assignments, comments, and updates."),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    }),
    Notifications.setNotificationChannelAsync(PRIORITY_CHANNEL_IDS.low, {
      name: t("low", "Low priority"),
      description: t("lowDescription", "Digests and informational updates."),
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
    }),
  ]);
  channelsEnsured = true;
}
