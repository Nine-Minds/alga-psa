import { describe, expect, it } from 'vitest';
import { externalMappingChangedEventPayloadSchema } from '@shared/workflow/runtime/schemas/integrationEventSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  buildExternalMappingChangedPublishParams,
  type TenantExternalEntityMappingRow,
} from '../externalMappingWorkflowEvents';

describe('external mapping workflow event payloads', () => {
  const tenantId = 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce';

  it('builds schema-valid EXTERNAL_MAPPING_CHANGED payload for create (previous undefined, new set)', () => {
    const after: TenantExternalEntityMappingRow = {
      id: 'a429ab08-8e7e-4ab4-8e88-cc6bf9aa8a5c',
      tenant: tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'tax_code',
      alga_entity_id: 'tax-1',
      external_entity_id: 'ext-tax-1',
      external_realm_id: 'realm-1',
      sync_status: 'synced',
      metadata: { rate: 0.1 },
      created_at: '2026-01-24T01:02:03.000Z',
      updated_at: '2026-01-24T01:02:03.000Z',
    };

    const { payload } = buildExternalMappingChangedPublishParams({
      after,
      changedAt: after.updated_at,
    });

    const enriched = buildWorkflowPayload(payload, {
      tenantId,
      occurredAt: after.updated_at,
      actor: { actorType: 'USER', actorUserId: 'b6f16b58-28fe-4bc5-9e84-7bb2b7189a0b' },
    });

    expect(externalMappingChangedEventPayloadSchema.parse(enriched)).toEqual(enriched);
    expect(enriched.previousValue).toBeUndefined();
    expect(enriched).toMatchObject({
      provider: 'quickbooks_online',
      mappingType: 'tax_code',
      mappingId: after.id,
      changedAt: after.updated_at,
      newValue: {
        algaEntityId: 'tax-1',
        externalEntityId: 'ext-tax-1',
        externalRealmId: 'realm-1',
        syncStatus: 'synced',
        metadata: { rate: 0.1 },
      },
    });
  });

  it('builds schema-valid EXTERNAL_MAPPING_CHANGED payload for update (previous/new values)', () => {
    const before: TenantExternalEntityMappingRow = {
      id: 'b8a1d8f0-2dd0-4e6b-9f7a-744b83fa2caa',
      tenant: tenantId,
      integration_type: 'xero',
      alga_entity_type: 'account',
      alga_entity_id: 'acct-1',
      external_entity_id: 'xero-acct-1',
      external_realm_id: null,
      sync_status: 'manual_link',
      metadata: null,
      created_at: '2026-01-20T01:00:00.000Z',
      updated_at: '2026-01-20T01:00:00.000Z',
    };

    const after: TenantExternalEntityMappingRow = {
      ...before,
      external_entity_id: 'xero-acct-2',
      sync_status: 'synced',
      updated_at: '2026-01-24T02:03:04.000Z',
    };

    const { payload } = buildExternalMappingChangedPublishParams({
      before,
      after,
      changedAt: after.updated_at,
    });

    const enriched = buildWorkflowPayload(payload, {
      tenantId,
      occurredAt: after.updated_at,
    });

    expect(externalMappingChangedEventPayloadSchema.parse(enriched)).toEqual(enriched);
    expect(enriched.previousValue).toEqual({
      algaEntityId: 'acct-1',
      externalEntityId: 'xero-acct-1',
      externalRealmId: null,
      syncStatus: 'manual_link',
      metadata: null,
    });
    expect(enriched.newValue).toEqual({
      algaEntityId: 'acct-1',
      externalEntityId: 'xero-acct-2',
      externalRealmId: null,
      syncStatus: 'synced',
      metadata: null,
    });
  });

  it('builds schema-valid EXTERNAL_MAPPING_CHANGED payload for delete (new null)', () => {
    const before: TenantExternalEntityMappingRow = {
      id: 'ed49d6e9-8707-478d-84cf-c0d8b2403a3d',
      tenant: tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'item',
      alga_entity_id: 'svc-1',
      external_entity_id: 'qbo-item-1',
      external_realm_id: 'realm-1',
      sync_status: 'synced',
      metadata: { source: 'manual' },
      created_at: '2026-01-20T01:00:00.000Z',
      updated_at: '2026-01-24T02:03:04.000Z',
    };

    const changedAt = '2026-01-24T05:06:07.000Z';
    const { payload } = buildExternalMappingChangedPublishParams({
      before,
      after: null,
      changedAt,
    });

    const enriched = buildWorkflowPayload(payload, {
      tenantId,
      occurredAt: changedAt,
    });

    expect(externalMappingChangedEventPayloadSchema.parse(enriched)).toEqual(enriched);
    expect(enriched.previousValue).toEqual({
      algaEntityId: 'svc-1',
      externalEntityId: 'qbo-item-1',
      externalRealmId: 'realm-1',
      syncStatus: 'synced',
      metadata: { source: 'manual' },
    });
    expect(enriched.newValue).toBeNull();
  });
});
