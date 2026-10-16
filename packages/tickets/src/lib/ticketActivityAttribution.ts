import type { TicketActivityRow } from '@alga-psa/shared/lib/ticketActivity';

/** Use historical attribution only; a foreign actor is never looked up in the
 * current workspace's user directory. Callers supply their translated fallback. */
export function ticketActivityAttribution(activity: Pick<TicketActivityRow,
  'actor_display_name' | 'actor_reference_id' | 'actor_organization_name'>): string | null {
  if (!activity.actor_display_name) return null;
  return activity.actor_reference_id && activity.actor_organization_name
    ? `${activity.actor_display_name} (${activity.actor_organization_name})`
    : activity.actor_display_name;
}
