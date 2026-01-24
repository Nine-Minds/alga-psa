import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  assetAssignedEventPayloadSchema,
  assetCreatedEventPayloadSchema,
  assetUnassignedEventPayloadSchema,
  assetUpdatedEventPayloadSchema,
  assetWarrantyExpiringEventPayloadSchema,
} from '../../../runtime/schemas/assetMediaEventSchemas';
import {
  buildAssetAssignedPayload,
  buildAssetCreatedPayload,
  buildAssetUnassignedPayload,
  buildAssetUpdatedPayload,
  buildAssetWarrantyExpiringPayload,
  computeAssetWarrantyExpiring,
} from '../assetEventBuilders';

describe('assetEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const assetId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const clientId = 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds ASSET_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildAssetCreatedPayload({
        assetId,
        clientId,
        createdByUserId: actorUserId,
        createdAt: occurredAt,
        assetType: 'workstation',
        serialNumber: 'SN-123',
      }),
      ctx
    );

    expect(assetCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds ASSET_UPDATED payloads with camelCase updatedFields/changes', () => {
    const before = {
      asset_id: assetId,
      client_id: clientId,
      name: 'Old Name',
      serial_number: 'SN-123',
      network_device: { management_ip: '10.0.0.1' },
    };
    const after = {
      asset_id: assetId,
      client_id: clientId,
      name: 'New Name',
      serial_number: 'SN-123',
      network_device: { management_ip: '10.0.0.2' },
    };

    const payload = buildWorkflowPayload(
      buildAssetUpdatedPayload({
        assetId,
        before,
        after,
        updatedPaths: ['name', 'network_device.management_ip'],
        updatedAt: occurredAt,
        updatedByUserId: actorUserId,
      }),
      ctx
    );

    expect(payload.updatedFields).toEqual(['name', 'networkDevice.managementIp']);
    expect(payload.changes).toEqual({
      name: { previous: 'Old Name', new: 'New Name' },
      'networkDevice.managementIp': { previous: '10.0.0.1', new: '10.0.0.2' },
    });
    expect(assetUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds ASSET_ASSIGNED and ASSET_UNASSIGNED payloads compatible with schema', () => {
    const assigned = buildWorkflowPayload(
      buildAssetAssignedPayload({
        assetId,
        previousOwnerType: 'client',
        previousOwnerId: clientId,
        newOwnerType: 'ticket',
        newOwnerId: 'ticket-123',
        assignedAt: occurredAt,
      }),
      ctx
    );
    expect(assetAssignedEventPayloadSchema.safeParse(assigned).success).toBe(true);

    const unassigned = buildWorkflowPayload(
      buildAssetUnassignedPayload({
        assetId,
        previousOwnerType: 'ticket',
        previousOwnerId: 'ticket-123',
        unassignedAt: occurredAt,
        reason: 'manual_detach',
      }),
      ctx
    );
    expect(assetUnassignedEventPayloadSchema.safeParse(unassigned).success).toBe(true);
  });

  it('computes warranty expiring threshold crossing and builds schema-compatible payloads', () => {
    const computed = computeAssetWarrantyExpiring({
      now: '2026-01-01T00:00:00.000Z',
      previousExpiresAt: '2026-03-15T00:00:00.000Z',
      newExpiresAt: '2026-01-15T00:00:00.000Z',
      windowDays: 30,
    });

    expect(computed).toEqual({ expiresAt: '2026-01-15T00:00:00.000Z', daysUntilExpiry: 14 });

    const payload = buildWorkflowPayload(
      buildAssetWarrantyExpiringPayload({
        assetId,
        clientId,
        ...computed!,
      }),
      ctx
    );

    expect(assetWarrantyExpiringEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

