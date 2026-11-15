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
 * Collaborator actors are named from their event snapshot only. Every other (psa/local) actor is
 * resolved by the caller's own `resolveLocal`, so psa notification text and queries stay exactly
 * what they were before co-management; no co-managed query is ever issued for a psa actor.
 */
export async function resolveTicketNotificationActorName(tenantId: string, actor: TicketNotificationActor,
  resolveLocal: () => Promise<string>): Promise<string> {
  if (actor.actorReference) {
    if (actor.userId || actor.actorReference.ownerTenantId !== tenantId) {
      throw new Error('Invalid notification actor attribution');
    }
    return formatCollaborationActorName(actor.actorReference);
  }
  return resolveLocal();
}
