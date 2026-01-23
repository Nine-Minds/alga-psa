import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  clientArchivedEventPayloadSchema,
  clientCreatedEventPayloadSchema,
  clientMergedEventPayloadSchema,
  clientOwnerAssignedEventPayloadSchema,
  clientStatusChangedEventPayloadSchema,
  clientUpdatedEventPayloadSchema,
} from '../../../runtime/schemas/crmEventSchemas';
import {
  buildClientArchivedPayload,
  buildClientCreatedPayload,
  buildClientMergedPayload,
  buildClientOwnerAssignedPayload,
  buildClientStatusChangedPayload,
  buildClientUpdatedPayload,
} from '../clientEventBuilders';

describe('clientEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const clientId = 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds CLIENT_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildClientCreatedPayload({
        clientId,
        clientName: 'Acme Corp',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
        status: 'active',
      }),
      ctx
    );

    expect(clientCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CLIENT_UPDATED payloads with field/path diffs compatible with schema', () => {
    const before = {
      client_id: clientId,
      client_name: 'Acme Corp',
      account_manager_id: null,
      properties: { status: 'prospect', website: 'https://old.example' },
    };
    const after = {
      client_id: clientId,
      client_name: 'Acme Corp, Inc.',
      account_manager_id: actorUserId,
      properties: { status: 'active', website: 'https://new.example' },
    };

    const payload = buildWorkflowPayload(
      buildClientUpdatedPayload({
        clientId,
        before,
        after,
        updatedAt: occurredAt,
        updatedFieldKeys: ['client_name', 'account_manager_id', 'properties'],
      }),
      ctx
    );

    expect(clientUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.updatedFields).toEqual(
      expect.arrayContaining(['clientName', 'accountManagerId', 'properties.status', 'properties.website'])
    );
    expect(payload.changes).toMatchObject({
      clientName: { previous: 'Acme Corp', new: 'Acme Corp, Inc.' },
      accountManagerId: { previous: null, new: actorUserId },
      'properties.status': { previous: 'prospect', new: 'active' },
      'properties.website': { previous: 'https://old.example', new: 'https://new.example' },
    });
  });

  it('builds CLIENT_STATUS_CHANGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildClientStatusChangedPayload({
        clientId,
        previousStatus: 'prospect',
        newStatus: 'active',
        changedAt: occurredAt,
      }),
      ctx
    );

    expect(clientStatusChangedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CLIENT_OWNER_ASSIGNED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildClientOwnerAssignedPayload({
        clientId,
        previousOwnerUserId: 'f05cceec-57bb-4a4c-8892-026d32f69b5a',
        newOwnerUserId: actorUserId,
        assignedByUserId: actorUserId,
        assignedAt: occurredAt,
      }),
      ctx
    );

    expect(clientOwnerAssignedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CLIENT_ARCHIVED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildClientArchivedPayload({
        clientId,
        archivedByUserId: actorUserId,
        archivedAt: occurredAt,
        reason: 'duplicate',
      }),
      ctx
    );

    expect(clientArchivedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CLIENT_MERGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildClientMergedPayload({
        sourceClientId: clientId,
        targetClientId: '6b4a7e9c-77b8-4c7c-bc9a-443eb32ff95c',
        mergedByUserId: actorUserId,
        mergedAt: occurredAt,
        strategy: 'manual',
      }),
      ctx
    );

    expect(clientMergedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

