/**
 * Huntress integration settings stored in rmm_integrations.settings (JSONB).
 * Pure parsing/validation helpers — no I/O.
 */

export interface HuntressSeverityPriorityMap {
  critical?: string;
  high?: string;
  low?: string;
}

export interface HuntressSettings {
  accountName?: string;
  accountSubdomain?: string;
  /** Max incident updated_at fully processed (ISO-8601). */
  incidentCursor?: string;
  pollIntervalMinutes: number;
  backfillDays: number;
  severityPriorityMap: HuntressSeverityPriorityMap;
  boardId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  fallbackClientId?: string;
  fallbackBoardId?: string;
  autoCloseTickets: boolean;
  closedStatusId?: string | null;
}

const DEFAULT_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_BACKFILL_DAYS = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseHuntressSettings(raw: unknown): HuntressSettings {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      // fall through to defaults
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }

  const rawMap = (obj.severityPriorityMap ?? {}) as Record<string, unknown>;
  const severityPriorityMap: HuntressSeverityPriorityMap = {};
  if (asString(rawMap.critical)) severityPriorityMap.critical = rawMap.critical as string;
  if (asString(rawMap.high)) severityPriorityMap.high = rawMap.high as string;
  if (asString(rawMap.low)) severityPriorityMap.low = rawMap.low as string;

  const pollInterval = Number(obj.pollIntervalMinutes);
  const backfill = Number(obj.backfillDays);

  return {
    accountName: asString(obj.accountName),
    accountSubdomain: asString(obj.accountSubdomain),
    incidentCursor: asString(obj.incidentCursor),
    pollIntervalMinutes: Number.isFinite(pollInterval)
      ? clamp(pollInterval, 1, 60)
      : DEFAULT_POLL_INTERVAL_MINUTES,
    backfillDays: Number.isFinite(backfill) ? clamp(backfill, 1, 30) : DEFAULT_BACKFILL_DAYS,
    severityPriorityMap,
    boardId: asString(obj.boardId),
    categoryId: asString(obj.categoryId) ?? null,
    subcategoryId: asString(obj.subcategoryId) ?? null,
    fallbackClientId: asString(obj.fallbackClientId),
    fallbackBoardId: asString(obj.fallbackBoardId),
    autoCloseTickets: obj.autoCloseTickets === true,
    closedStatusId: asString(obj.closedStatusId) ?? null,
  };
}

export function isRoutingConfigComplete(settings: HuntressSettings): boolean {
  return Boolean(
    settings.boardId &&
      settings.fallbackClientId &&
      settings.fallbackBoardId &&
      settings.severityPriorityMap.critical &&
      settings.severityPriorityMap.high &&
      settings.severityPriorityMap.low
  );
}

/** Name preference order per Huntress severity, lowercased. */
const SEVERITY_NAME_PREFERENCES: Record<keyof HuntressSeverityPriorityMap, string[]> = {
  critical: ['critical', 'urgent'],
  high: ['high'],
  low: ['medium', 'low'],
};

export function prefillSeverityPriorityMap(
  priorities: Array<{ priority_id: string; priority_name: string }>
): HuntressSeverityPriorityMap {
  const byName = new Map<string, string>();
  for (const p of priorities) {
    const key = p.priority_name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, p.priority_id);
  }

  const map: HuntressSeverityPriorityMap = {};
  for (const severity of Object.keys(SEVERITY_NAME_PREFERENCES) as Array<
    keyof HuntressSeverityPriorityMap
  >) {
    for (const name of SEVERITY_NAME_PREFERENCES[severity]) {
      const id = byName.get(name);
      if (id) {
        map[severity] = id;
        break;
      }
    }
  }
  return map;
}

export function isPollDue(
  lastSyncAt: string | Date | null | undefined,
  intervalMinutes: number,
  now: Date
): boolean {
  if (!lastSyncAt) return true;
  const last = lastSyncAt instanceof Date ? lastSyncAt.getTime() : Date.parse(lastSyncAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= intervalMinutes * 60_000;
}
