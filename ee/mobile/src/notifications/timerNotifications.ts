import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import i18n from "../i18n/i18n";
import { logger } from "../logging/logger";
import { getHideSensitiveNotificationsEnabled } from "../settings/privacyPreferences";
import { getDateTimeLocale } from "../ui/formatters/dateTime";
import {
  diffTimerReminders,
  planTimerReminders,
  type RunningTimerSnapshot,
} from "../features/timer/timerLogic";

export const TIMER_NOTIFICATION_KIND = "time-tracking";
const ONGOING_IDENTIFIER_PREFIX = "time-tracking-ongoing:";
const ONGOING_CHANNEL_ID = "time-tracking";
const REMINDER_CHANNEL_ID = "time-tracking-reminders";

function ongoingIdentifier(sessionId: string): string {
  return `${ONGOING_IDENTIFIER_PREFIX}${sessionId}`;
}

function workItemLabel(snapshot: RunningTimerSnapshot, hideSensitive: boolean): string {
  if (hideSensitive || !snapshot.workItemTitle) {
    return i18n.t("timeEntries:timer.notifications.genericWorkItem", { defaultValue: "a work item" });
  }
  return snapshot.workItemTitle;
}

function notificationData(snapshot: RunningTimerSnapshot): Record<string, unknown> {
  return {
    kind: TIMER_NOTIFICATION_KIND,
    ...(snapshot.workItemType === "ticket" && snapshot.workItemId
      ? { ticketId: snapshot.workItemId }
      : {}),
  };
}

function formatStartTime(startTimeMs: number): string {
  try {
    return new Intl.DateTimeFormat(getDateTimeLocale(), { timeStyle: "short" }).format(
      new Date(startTimeMs),
    );
  } catch {
    return new Date(startTimeMs).toISOString();
  }
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ONGOING_CHANNEL_ID, {
    name: i18n.t("timeEntries:timer.notifications.ongoingChannelName", { defaultValue: "Time tracking" }),
    importance: Notifications.AndroidImportance.LOW,
  });
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: i18n.t("timeEntries:timer.notifications.reminderChannelName", { defaultValue: "Timer reminders" }),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function dismissPresentedTimerNotifications(exceptIdentifier?: string): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const toDismiss = presented.filter((n) => {
    const data = n.request.content.data as Record<string, unknown> | undefined;
    if (data?.kind !== TIMER_NOTIFICATION_KIND) return false;
    return n.request.identifier !== exceptIdentifier;
  });
  await Promise.all(
    toDismiss.map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
  );
}

/**
 * Reconciles OS notifications with the current tracking session. Running:
 * a sticky Android status notification plus escalating "still running"
 * reminders on both platforms. Idle: everything timer-related is removed.
 */
export async function syncTimerNotifications(
  snapshot: RunningTimerSnapshot | null,
  now: Date = new Date(),
): Promise<void> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.status !== "granted") return;

    const planned = snapshot ? planTimerReminders(snapshot, now.getTime()) : [];

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const existingIdentifiers = scheduled
      .filter((n) => (n.content?.data as Record<string, unknown> | undefined)?.kind === TIMER_NOTIFICATION_KIND)
      .map((n) => n.identifier);

    const { toCancel, toSchedule } = diffTimerReminders(existingIdentifiers, planned);
    await Promise.all(toCancel.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));

    if (!snapshot) {
      await dismissPresentedTimerNotifications();
      return;
    }

    const hideSensitive = await getHideSensitiveNotificationsEnabled();
    const label = workItemLabel(snapshot, hideSensitive);

    if (toSchedule.length > 0 || Platform.OS === "android") {
      await ensureAndroidChannels();
    }

    await Promise.all(
      toSchedule.map((reminder) =>
        Notifications.scheduleNotificationAsync({
          identifier: reminder.identifier,
          content: {
            title: i18n.t("timeEntries:timer.notifications.reminderTitle", { defaultValue: "Timer still running" }),
            body: i18n.t("timeEntries:timer.notifications.reminderBody", {
              defaultValue: "You have been tracking time on {{workItem}} for {{hours}}h.",
              workItem: label,
              hours: Math.round(reminder.thresholdMinutes / 60),
            }),
            sound: "default",
            data: notificationData(snapshot),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminder.fireAt,
            channelId: Platform.OS === "android" ? REMINDER_CHANNEL_ID : undefined,
          },
        }),
      ),
    );

    // The persistent "timer running" entry is Android-only: iOS has no
    // non-dismissable notification concept, so reminders carry that role.
    if (Platform.OS === "android") {
      const identifier = ongoingIdentifier(snapshot.sessionId);
      await dismissPresentedTimerNotifications(identifier);
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: i18n.t("timeEntries:timer.notifications.ongoingTitle", { defaultValue: "Timer running" }),
          body: i18n.t("timeEntries:timer.notifications.ongoingBody", {
            defaultValue: "{{workItem}} · started at {{time}}",
            workItem: label,
            time: formatStartTime(snapshot.startTimeMs - snapshot.offsetMs),
          }),
          sticky: true,
          autoDismiss: false,
          data: notificationData(snapshot),
        },
        trigger: { channelId: ONGOING_CHANNEL_ID },
      });
    }
  } catch (err) {
    logger.warn("[TimerNotifications] Failed to sync", { err });
  }
}
