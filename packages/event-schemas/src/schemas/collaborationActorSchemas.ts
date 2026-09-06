import { z } from 'zod';

/** Historical attribution, never a credential or a request execution identity. */
export const collaborationActorReferenceSchema = z.object({
  ownerTenantId: z.string().uuid(),
  referenceId: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1),
  organizationName: z.string().min(1),
}).strict().refine(actor => actor.ownerTenantId !== actor.tenantId, 'A collaborator belongs to a different tenant');
export type CollaborationActorReference = z.infer<typeof collaborationActorReferenceSchema>;

/** Validate before a payload schema can strip legacy actor fields. */
export function collaborationActorPayloadIssue(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const payload = input as Record<string, unknown>;
  if (payload.actorType !== 'COLLABORATOR' && payload.actorReference == null) return null;
  if (payload.actorType !== 'COLLABORATOR') return 'A collaboration actor reference requires COLLABORATOR attribution';
  const parsed = collaborationActorReferenceSchema.safeParse(payload.actorReference);
  if (!parsed.success || parsed.data.ownerTenantId !== payload.tenantId) return 'A collaborator requires an actor reference in the event owning tenant';
  if (['userId', 'actorUserId', 'actorContactId', 'createdByUserId', 'updatedByUserId', 'closedByUserId', 'assignedByUserId']
    .some(key => payload[key] != null)) return 'A collaborator cannot also be attributed to a tenant-local actor';
  return null;
}

/** Display the saved source organization without consulting a local user directory. */
export function formatCollaborationActorName(actor: CollaborationActorReference): string {
  return `${actor.displayName} (${actor.organizationName})`;
}
