import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { collaborationActorPayloadIssue, collaborationActorReferenceSchema, formatCollaborationActorName,
  type CollaborationActorReference } from '@alga-psa/event-schemas/collaboration';

export interface TicketNotificationActor {
  /** Empty for a system or foreign actor. Never contains a source-tenant user ID. */
  userId: string;
  actorReference?: CollaborationActorReference;
}

/** Redis accumulation must retain the event snapshot rather than flattening its source ID. */
export function readTicketNotificationActor(payload: Record<string, unknown>, tenantId: string,
  legacyUserId?: string): TicketNotificationActor {
  const issue = collaborationActorPayloadIssue(payload);
  if (issue) throw new Error(issue);
  if (payload.actorType === 'COLLABORATOR') {
    const actorReference = collaborationActorReferenceSchema.parse(payload.actorReference);
    if (actorReference.ownerTenantId !== tenantId) throw new Error('Notification actor belongs to another owning tenant');
    return { userId: '', actorReference };
  }
  return { userId: legacyUserId || '' };
}

/**
 * Display name for a users row, or `fallback` when the row is missing or has no
 * usable name (a null first/last name must not render as "null null").
 */
// LEVERAGE: pattern user-display-name — `${u.first_name} ${u.last_name}` is repeated across notification handlers
export function userDisplayName(
  user: { first_name?: string | null; last_name?: string | null } | null | undefined,
  fallback: string
): string {
  const name = user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : '';
  return name || fallback;
}

/** One owner-local lookup for a batch; foreign snapshots never enter the local directory. */
export async function resolveTicketNotificationActorNames(db: Knex, tenantId: string, actors: readonly TicketNotificationActor[],
  missingUser: string = 'System'): Promise<string[]> {
  for (const actor of actors) {
    if (actor.actorReference && (actor.userId || actor.actorReference.ownerTenantId !== tenantId)) {
      throw new Error('Invalid notification actor attribution');
    }
  }
  const userIds = [...new Set(actors.filter(actor => !actor.actorReference && actor.userId).map(actor => actor.userId))];
  const rows = userIds.length ? await tenantDb(db, tenantId).table('users').whereIn('user_id', userIds)
    .select('user_id', 'first_name', 'last_name') : [];
  const names = new Map<string, string>(rows.map(row => [row.user_id, userDisplayName(row, '')]));
  return actors.map(actor => actor.actorReference ? formatCollaborationActorName(actor.actorReference)
    : names.get(actor.userId) || missingUser);
}
