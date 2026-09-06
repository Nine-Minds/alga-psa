import { describe, expect, it } from 'vitest';
import { EventSchemas } from './eventBusSchema';
import { buildWorkflowPayload } from './workflowEventPublishHelpers';

const owner = '00000000-0000-4000-8000-000000000001';
const reference = {
  ownerTenantId: owner, referenceId: '00000000-0000-4000-8000-000000000002',
  tenantId: '00000000-0000-4000-8000-000000000003', userId: '00000000-0000-4000-8000-000000000004',
  displayName: 'Morgan Lee', organizationName: 'Service Partner',
};
const timestamp = '2026-09-06T20:00:00.000Z';
const ctx = { tenantId: owner, occurredAt: timestamp, actor: { actorType: 'COLLABORATOR' as const, actorReference: reference } };
const ticketId = '00000000-0000-4000-8000-000000000005';
const envelope = { id: ticketId, timestamp };

describe('qualified collaboration event attribution', () => {
  it.each(['TICKET_UPDATED', 'TICKET_CLOSED', 'TICKET_ASSIGNED'] as const)('retains the owner-local reference and source snapshot through %s publication', eventType => {
    const payload = buildWorkflowPayload({ ticketId, changes: { title: { previous: 'Old', new: 'New' } } }, ctx);
    const parsed = EventSchemas[eventType].parse({ ...envelope, eventType, payload });
    expect(parsed.payload).toMatchObject({ actorType: 'COLLABORATOR', actorReference: reference, changes: payload.changes });
    expect(parsed.payload).not.toHaveProperty('userId');
    expect(parsed.payload).not.toHaveProperty('actorUserId');
  });

  it.each(['userId', 'actorUserId', 'actorContactId', 'updatedByUserId', 'closedByUserId', 'createdByUserId', 'assignedByUserId'])('rejects mixed %s attribution before unknown fields can be stripped', field => {
    const payload = buildWorkflowPayload({ ticketId }, ctx);
    const forged = { ...payload, [field]: reference.userId };
    expect(EventSchemas.TICKET_UPDATED.safeParse({ ...envelope, eventType: 'TICKET_UPDATED', payload: forged }).success).toBe(false);
    expect(() => buildWorkflowPayload({ ticketId, [field]: reference.userId }, ctx)).toThrow('tenant-local actor');
  });

  it.each([
    { actorReference: undefined },
    { actorType: 'USER', actorUserId: reference.userId },
    { actorReference: { ...reference, ownerTenantId: reference.tenantId } },
    { actorReference: { ...reference, tenantId: owner } },
    { actorReference: { ...reference, userId: 'invalid' } },
  ])('rejects missing, malformed and cross-owner references', alteration => {
    const payload = { ...buildWorkflowPayload({ ticketId }, ctx), ...alteration };
    expect(EventSchemas.TICKET_UPDATED.safeParse({ ...envelope, eventType: 'TICKET_UPDATED', payload }).success).toBe(false);
  });

  it('retains attribution in the legacy response-state branch with no tenant-local actor', () => {
    const payload = buildWorkflowPayload({ ticketId, userId: null, previousState: 'awaiting_client', newState: null, trigger: 'close' }, ctx);
    expect(EventSchemas.TICKET_RESPONSE_STATE_CHANGED.parse({ ...envelope, eventType: 'TICKET_RESPONSE_STATE_CHANGED', payload }).payload)
      .toMatchObject({ actorType: 'COLLABORATOR', actorReference: reference, userId: null, trigger: 'close' });
  });

  it('copies reference metadata and preserves ordinary user and system producers', () => {
    const payload = buildWorkflowPayload({ ticketId }, ctx);
    expect(payload.actorReference).not.toBe(reference);
    expect(buildWorkflowPayload({ ticketId }, { ...ctx, actor: { actorType: 'USER', actorUserId: reference.userId } }))
      .toMatchObject({ actorType: 'USER', actorUserId: reference.userId });
    expect(buildWorkflowPayload({ ticketId }, { ...ctx, actor: { actorType: 'SYSTEM' } }))
      .toMatchObject({ actorType: 'SYSTEM' });
  });
});
