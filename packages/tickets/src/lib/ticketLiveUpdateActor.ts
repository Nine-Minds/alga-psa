import { collaborationActorReferenceSchema, formatCollaborationActorName, publicCollaborationActorReferenceSchema,
  toPublicCollaborationActorReference, type CollaborationActorReference, type PublicCollaborationActorReference } from '@alga-psa/event-schemas/collaboration';

export type TicketLiveUpdateActor =
  | { userId: string; displayName: string; actorReference?: never }
  | { userId: null; displayName: string; actorReference: PublicCollaborationActorReference };

export type TicketLiveUpdateActorInput =
  | { userId: string; displayName: string; actorReference?: never }
  | { userId: null; displayName: string; actorReference: CollaborationActorReference };

/** Used on both publication and receipt. A source user ID is never a local ID. */
export function parseTicketLiveUpdateActor(input: unknown, ownerTenantId?: string): TicketLiveUpdateActor | null {
  if (!input || typeof input !== 'object') return null;
  const actor = input as Record<string, unknown>;
  if (actor.actorReference !== undefined) {
    const parsed = publicCollaborationActorReferenceSchema.safeParse(actor.actorReference);
    if (actor.userId !== null || !parsed.success || parsed.data.ownerTenantId !== ownerTenantId) return null;
    return { userId: null, displayName: formatCollaborationActorName(parsed.data), actorReference: parsed.data };
  }
  if (typeof actor.userId !== 'string' || !actor.userId || typeof actor.displayName !== 'string' || !actor.displayName) return null;
  return { userId: actor.userId, displayName: actor.displayName };
}

/** Server publication boundary: validate the internal attribution then project it. */
export function projectTicketLiveUpdateActor(input: unknown, ownerTenantId: string): TicketLiveUpdateActor | null {
  if (!input || typeof input !== 'object') return null;
  const actor = input as Record<string, unknown>;
  if (actor.actorReference === undefined) return parseTicketLiveUpdateActor(input, ownerTenantId);
  const parsed = collaborationActorReferenceSchema.safeParse(actor.actorReference);
  if (actor.userId !== null || !parsed.success || parsed.data.ownerTenantId !== ownerTenantId) return null;
  const actorReference = toPublicCollaborationActorReference(parsed.data);
  return { userId: null, displayName: formatCollaborationActorName(actorReference), actorReference };
}
