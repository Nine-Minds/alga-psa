import { createApiClient } from "../api";
import { listScheduleEntries } from "../api/schedule";
import { getAppConfig } from "../config/appConfig";
import { startOfWeek, weekQueryRange } from "../features/schedule/scheduleUtils";
import { logger } from "../logging/logger";
import { syncScheduleReminders } from "./scheduleReminders";

// Reminders are local notifications, so they only exist for the range the app
// has synced. Two weeks covers entries added on the web for next week.
export const REMINDER_SYNC_WEEKS = 2;

/** Fetch the upcoming schedule and (re)schedule local reminders for it. */
export async function resyncScheduleReminders(params: {
  accessToken: string;
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  refreshSession?: () => Promise<string | null>;
}): Promise<void> {
  const config = getAppConfig();
  if (!config.ok) return;
  try {
    const client = createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => params.tenantId ?? undefined,
      getUserAgentTag: () => "mobile/schedule-reminders",
      onAuthError: params.refreshSession,
    });
    const weekStart = startOfWeek(new Date());
    const { startIso } = weekQueryRange(weekStart);
    const { endIso } = weekQueryRange(new Date(weekStart.getTime() + (REMINDER_SYNC_WEEKS - 1) * 7 * 24 * 60 * 60 * 1000));
    const result = await listScheduleEntries(client, {
      apiKey: params.accessToken,
      startDate: startIso,
      endDate: endIso,
      userId: params.userId ?? undefined,
    });
    if (result.ok && Array.isArray(result.data.data)) {
      await syncScheduleReminders(result.data.data, { startIso, endIso });
    }
  } catch (err) {
    logger.warn("[Notifications] Schedule reminder sync failed", { err });
  }
}

