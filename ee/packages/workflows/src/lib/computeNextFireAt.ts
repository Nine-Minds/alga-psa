import { parseExpression } from 'cron-parser';

/**
 * Compute the next fire time for a recurring cron schedule.
 *
 * Delegates to cron-parser which handles the full 5-field cron spec
 * including steps (asterisk/5), ranges (1-5), month filters, etc.
 *
 * Returns an ISO 8601 string (UTC) or null if the expression is invalid.
 */
export function computeNextFireAt(
  cron: string,
  timezone: string,
  after?: Date
): string | null {
  try {
    const expression = parseExpression(cron, {
      currentDate: after ?? new Date(),
      tz: timezone || 'UTC'
    });
    const next = expression.next();
    return next.toISOString();
  } catch {
    return null;
  }
}

/**
 * Compute next_fire_at for a schedule given its timing fields.
 * Accepts both camelCase (DesiredWorkflowSchedule) and snake_case (DB record) field names.
 * Returns null for non-recurring, disabled, or unparseable schedules.
 */
export function computeNextFireAtForSchedule(params: {
  triggerType?: string;
  trigger_type?: string;
  cron?: string | null;
  timezone?: string | null;
  enabled: boolean;
}): string | null {
  const triggerType = params.triggerType ?? params.trigger_type;
  if (triggerType !== 'recurring' || !params.cron || !params.enabled) {
    return null;
  }
  return computeNextFireAt(params.cron, params.timezone ?? 'UTC');
}
