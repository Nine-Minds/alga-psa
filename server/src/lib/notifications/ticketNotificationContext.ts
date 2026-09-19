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

/** One owner-local lookup for a batch; foreign snapshots never enter the local directory. */
export async function resolveTicketNotificationActorNames(db: Knex, tenantId: string, actors: readonly TicketNotificationActor[],
  missingUser: 'System' | 'Someone' | 'userId' = 'System'): Promise<string[]> {
  for (const actor of actors) {
    if (actor.actorReference && (actor.userId || actor.actorReference.ownerTenantId !== tenantId)) {
      throw new Error('Invalid notification actor attribution');
    }
  }
  const userIds = [...new Set(actors.filter(actor => !actor.actorReference && actor.userId).map(actor => actor.userId))];
  const rows = userIds.length ? await tenantDb(db, tenantId).table('users').whereIn('user_id', userIds)
    .select('user_id', 'first_name', 'last_name') : [];
  const names = new Map<string, string>(rows.map(row => [row.user_id, `${row.first_name} ${row.last_name}`]));
  return actors.map(actor => actor.actorReference ? formatCollaborationActorName(actor.actorReference)
    : names.get(actor.userId) || (missingUser === 'userId' ? actor.userId || 'System' : missingUser));
}

/** Accept the legacy old/new and domain previous/new change contracts without losing null. */
export function previousTicketChangeValue(change: Record<string, unknown>): unknown {
  return Object.prototype.hasOwnProperty.call(change, 'old') ? change.old : change.previous;
}
