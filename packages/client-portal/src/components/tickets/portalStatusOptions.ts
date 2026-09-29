import type { IStatus } from '@alga-psa/types';

/**
 * Statuses a client-portal picker may offer:
 *   - every status an administrator marked portal-selectable, plus
 *   - the ticket's current status, even when it is not selectable, so the
 *     current label stays readable instead of rendering blank (D4).
 *
 * Derived from the current status id on every render rather than captured once,
 * so a restricted status that the ticket is currently in drops out of the
 * picker as soon as the ticket moves to a different status. Omitting this
 * derivation left the old status offered until a full reload.
 */
export function derivePortalStatusOptions(
  statusOptions: IStatus[],
  currentStatusId?: string | null
): IStatus[] {
  return statusOptions.filter(
    (status) => status.portal_selectable !== false || status.status_id === currentStatusId
  );
}
