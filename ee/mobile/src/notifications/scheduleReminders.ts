import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import i18n from "../i18n/i18n";
import type { ScheduleEntry } from "../api/schedule";
import { getDateTimeLocale } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";
import { DEFAULT_REMINDER_LEAD_MINUTES, getReminderLeadMinutes } from "../settings/notificationPreferences";

export const SCHEDULE_REMINDER_KIND = "schedule-reminder";
/** @deprecated leads are a device preference now; kept for the default. */
export const REMINDER_LEAD_MINUTES = DEFAULT_REMINDER_LEAD_MINUTES[0];
// iOS keeps at most 64 pending local notifications per app; timer reminders
// share that budget, so schedule reminders stop well short of it.
export const MAX_PENDING_SCHEDULE_REMINDERS = 48;
const IDENTIFIER_PREFIX = "schedule-reminder:";
const ANDROID_CHANNEL_ID = "schedule-reminders";

export type PlannedReminder = {
  identifier: string;
  entryId: string;
  title: string;
  startsAt: Date;
  fireAt: Date;
  leadMinutes: number;
  workItemType: string | null;
  workItemId: string | null;
};

export function reminderIdentifier(entryId: string, startMs: number, leadMinutes: number): string {
  return `${IDENTIFIER_PREFIX}${entryId}:${startMs}:${leadMinutes}`;
}

/** Accepts both the current `entry:start:lead` form and the older `entry:start` form. */
export function parseReminderIdentifier(
  identifier: string,
): { entryId: string; startMs: number; leadMinutes: number | null } | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const parts = identifier.slice(IDENTIFIER_PREFIX.length).split(":");
  if (parts.length < 2) return null;
  const numeric = parts.slice(-2).map(Number);
  const hasLead = parts.length >= 3 && numeric.every(Number.isFinite);
  const startMs = hasLead ? numeric[0] : Number(parts[parts.length - 1]);
  if (!Number.isFinite(startMs)) return null;
  const entryId = parts.slice(0, hasLead ? -2 : -1).join(":");
  if (!entryId) return null;
  return { entryId, startMs, leadMinutes: hasLead ? numeric[1] : null };
}

export function planScheduleReminders(
  entries: ScheduleEntry[],
  { now, leadMinutes = DEFAULT_REMINDER_LEAD_MINUTES, limit = MAX_PENDING_SCHEDULE_REMINDERS }: { now: Date; leadMinutes?: number[]; limit?: number },
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry?.entry_id || !entry.scheduled_start) continue;
    const startsAt = new Date(entry.scheduled_start);
    if (Number.isNaN(startsAt.getTime())) continue;
    for (const lead of leadMinutes) {
      const fireAt = new Date(startsAt.getTime() - lead * 60 * 1000);
      if (fireAt.getTime() <= now.getTime()) continue;
      const identifier = reminderIdentifier(entry.entry_id, startsAt.getTime(), lead);
      if (seen.has(identifier)) continue;
      seen.add(identifier);
      planned.push({
        identifier,
        entryId: entry.entry_id,
        title: entry.title ?? "",
        startsAt,
        fireAt,
        leadMinutes: lead,
        workItemType: entry.work_item_type ?? null,
        workItemId: entry.work_item_id ?? null,
      });
    }
  }
  // Soonest first so the cap drops the furthest-out reminders, which a later
  // sync will pick up again once nearer ones have fired.
  planned.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return planned.slice(0, limit);
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
  leadMinutes?: number[],
): Promise<void> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.status !== "granted") return;

    const startMs = Date.parse(window.startIso);
    const endMs = Date.parse(window.endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;

    const leads = leadMinutes ?? (await getReminderLeadMinutes());
    const planned = planScheduleReminders(entries, { now, leadMinutes: leads });
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
            body: i18n.t("schedule:reminders.bodyWithLead", {
              defaultValue: "Starts at {{time}} ({{minutes}} min)",
              time: formatStartTime(reminder.startsAt),
              minutes: reminder.leadMinutes,
            }),
            sound: "default",
            data: {
              kind: SCHEDULE_REMINDER_KIND,
              entryId: reminder.entryId,
              url: "alga://schedule",
              workItemType: reminder.workItemType,
              workItemId: reminder.workItemId,
            },
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
