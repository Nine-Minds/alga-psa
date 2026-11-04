import { parseCustomRecurrence } from './maintenanceRecurrence';

export type CadenceTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Locale keys for weekdays, indexed by the rule's 0 = Sunday … 6 = Saturday. */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_ENGLISH = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Human cadence for a schedule, e.g. "Every 2 weeks on Mon, Thu". Shared by
 * the schedules table and the dialog preview so both read the same.
 */
export function describeMaintenanceCadence(
  t: CadenceTranslate,
  frequency: string,
  interval: number | undefined,
  scheduleConfig?: Record<string, unknown>,
): string {
  const count = interval && interval > 0 ? interval : 1;
  const every = (unit: string) => t('maintenanceSchedulesTab.frequency.every', { defaultValue: 'Every {{count}} {{frequency}}', count, frequency: unit });
  if (frequency !== 'custom') {
    return every(t(`maintenanceSchedulesTab.frequency.units.${frequency}`, { count, defaultValue: frequency }));
  }
  let rule;
  try {
    rule = parseCustomRecurrence(scheduleConfig);
  } catch {
    return t('maintenanceSchedulesTab.frequency.customUnconfigured', { defaultValue: 'Custom (not configured)' });
  }
  const cadence = every(t(`maintenanceSchedulesTab.frequency.customUnits.${rule.unit}`, { count, defaultValue: rule.unit }));
  if (rule.weekdays?.length) {
    const days = [...rule.weekdays].sort((a, b) => a - b)
      .map((day) => t(`maintenanceSchedulesTab.frequency.weekdays.${WEEKDAY_KEYS[day]}`, { defaultValue: WEEKDAY_ENGLISH[day] }))
      .join(', ');
    return t('maintenanceSchedulesTab.frequency.onWeekdays', { defaultValue: '{{cadence}} on {{days}}', cadence, days });
  }
  if (rule.days_of_month?.length) {
    const days = [...rule.days_of_month].sort((a, b) => a - b).join(', ');
    return t('maintenanceSchedulesTab.frequency.onDaysOfMonth', { defaultValue: '{{cadence}} on day {{days}}', cadence, days });
  }
  return cadence;
}
