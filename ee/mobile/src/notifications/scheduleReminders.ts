import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import i18n from "../i18n/i18n";
import type { ScheduleEntry } from "../api/schedule";
import { getDateTimeLocale } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";

export const SCHEDULE_REMINDER_KIND = "schedule-reminder";
export const REMINDER_LEAD_MINUTES = 15;
const IDENTIFIER_PREFIX = "schedule-reminder:";
const ANDROID_CHANNEL_ID = "schedule-reminders";

export type PlannedReminder = {
  identifier: string;
  entryId: string;
  title: string;
  startsAt: Date;
  fireAt: Date;
};

export function reminderIdentifier(entryId: string, startMs: number): string {
  return `${IDENTIFIER_PREFIX}${entryId}:${startMs}`;
}

export function parseReminderIdentifier(
  identifier: string,
): { entryId: string; startMs: number } | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const rest = identifier.slice(IDENTIFIER_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return null;
  const startMs = Number(rest.slice(sep + 1));
  if (!Number.isFinite(startMs)) return null;
  return { entryId: rest.slice(0, sep), startMs };
}

export function planScheduleReminders(
  entries: ScheduleEntry[],
  { now }: { now: Date },
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry?.entry_id || !entry.scheduled_start) continue;
    const startsAt = new Date(entry.scheduled_start);
    if (Number.isNaN(startsAt.getTime())) continue;
    const fireAt = new Date(startsAt.getTime() - REMINDER_LEAD_MINUTES * 60 * 1000);
    if (fireAt.getTime() <= now.getTime()) continue;
    const identifier = reminderIdentifier(entry.entry_id, startsAt.getTime());
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    planned.push({ identifier, entryId: entry.entry_id, title: entry.title ?? "", startsAt, fireAt });
  }
  return planned;
}

/**
 * Reminders are pruned only when their event start falls inside the synced
 * window: entries outside the fetched range were not loaded, so their
 * reminders must survive a sync for a different week.
 */
export function diffScheduleReminders(
  existingIdentifiers: string[],
  planned: PlannedReminder[],
  window: { startMs: number; endMs: number },
): { toCancel: string[]; toSchedule: PlannedReminder[] } {
  const plannedIds = new Set(planned.map((p) => p.identifier));
  const existing = new Set(existingIdentifiers);
  const toCancel = existingIdentifiers.filter((identifier) => {
    if (plannedIds.has(identifier)) return false;
    const parsed = parseReminderIdentifier(identifier);
    if (!parsed) return false;
    return parsed.startMs >= window.startMs && parsed.startMs <= window.endMs;
  });
  const toSchedule = planned.filter((p) => !existing.has(p.identifier));
  return { toCancel, toSchedule };
}

function formatStartTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat(getDateTimeLocale(), { timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: i18n.t("schedule:reminders.channelName", { defaultValue: "Schedule reminders" }),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export async function syncScheduleReminders(
  entries: ScheduleEntry[],
  window: { startIso: string; endIso: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.status !== "granted") return;

    const startMs = Date.parse(window.startIso);
    const endMs = Date.parse(window.endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;

    const planned = planScheduleReminders(entries, { now });
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const existingIdentifiers = scheduled
      .filter((n) => (n.content?.data as Record<string, unknown> | undefined)?.kind === SCHEDULE_REMINDER_KIND)
      .map((n) => n.identifier);

    const { toCancel, toSchedule } = diffScheduleReminders(existingIdentifiers, planned, { startMs, endMs });
    if (toCancel.length === 0 && toSchedule.length === 0) return;

    if (toSchedule.length > 0) {
      await ensureAndroidChannel();
    }

    await Promise.all(toCancel.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));
    await Promise.all(
      toSchedule.map((reminder) =>
        Notifications.scheduleNotificationAsync({
          identifier: reminder.identifier,
          content: {
            title: reminder.title || i18n.t("schedule:reminders.fallbackTitle", { defaultValue: "Upcoming schedule entry" }),
            body: i18n.t("schedule:reminders.body", {
              defaultValue: "Starts at {{time}}",
              time: formatStartTime(reminder.startsAt),
            }),
            sound: "default",
            data: { kind: SCHEDULE_REMINDER_KIND, entryId: reminder.entryId, url: "alga://schedule" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminder.fireAt,
            channelId: Platform.OS === "android" ? ANDROID_CHANNEL_ID : undefined,
          },
        }),
      ),
    );

    logger.info("[ScheduleReminders] Synced reminders", {
      scheduled: toSchedule.length,
      canceled: toCancel.length,
    });
  } catch (err) {
    logger.warn("[ScheduleReminders] Failed to sync reminders", { err });
  }
}
