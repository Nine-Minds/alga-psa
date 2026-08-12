import { ActivityPriority } from '@alga-psa/types';

/**
 * Map the stored in-app notification priority (high|normal|low, from task
 * 29.8.46) to the activity feed's ActivityPriority tier. Falls back to the
 * legacy notification `type`→priority derivation (error→HIGH, warning→MEDIUM,
 * else LOW) only when the stored priority is absent — e.g. rows created before
 * the backfill, or a payload that predates the column.
 *
 * LEVERAGE: friction notification-priority-mapper — the same stored→tier +
 * legacy-fallback logic also exists in
 * packages/client-portal/.../notificationActivities.ts. Kept per-package per
 * the task's "no drive-by refactors" scope; a shared @alga-psa/types helper is
 * the natural home if a third copy appears.
 */
export function mapStoredNotificationPriority(
  storedPriority: string | null | undefined,
  type: string | null | undefined,
  priorityFeatureEnabled: boolean = true
): ActivityPriority {
  if (priorityFeatureEnabled) {
    switch (storedPriority) {
      case 'high':
        return ActivityPriority.HIGH;
      case 'normal':
        return ActivityPriority.MEDIUM;
      case 'low':
        return ActivityPriority.LOW;
    }
  }
  switch (type) {
    case 'error':
      return ActivityPriority.HIGH;
    case 'warning':
      return ActivityPriority.MEDIUM;
    default:
      return ActivityPriority.LOW;
  }
}
