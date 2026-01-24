import { buildExternalMappingChangedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/externalMappingEventBuilders';

export type TenantExternalEntityMappingRow = {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ExternalMappingValue = {
  algaEntityId: string;
  externalEntityId: string;
  externalRealmId: string | null;
  syncStatus: string | null;
  metadata: Record<string, unknown> | null;
};

function toExternalMappingValue(row: TenantExternalEntityMappingRow): ExternalMappingValue {
  return {
    algaEntityId: row.alga_entity_id,
    externalEntityId: row.external_entity_id,
    externalRealmId: row.external_realm_id ?? null,
    syncStatus: row.sync_status ?? null,
    metadata: row.metadata ?? null,
  };
}

export function buildExternalMappingChangedPublishParams(params: {
  before?: TenantExternalEntityMappingRow | null;
  after?: TenantExternalEntityMappingRow | null;
  changedAt: string;
}): { payload: Record<string, unknown>; idempotencyKey: string } {
  const mapping = params.after ?? params.before;
  if (!mapping) {
    throw new Error('Expected at least one mapping row (before or after) to build EXTERNAL_MAPPING_CHANGED.');
  }

  const previousValue = params.before ? toExternalMappingValue(params.before) : undefined;
  const newValue =
    params.after ? toExternalMappingValue(params.after) : params.before ? null : undefined;

  const payload = buildExternalMappingChangedPayload({
    provider: mapping.integration_type,
    mappingType: mapping.alga_entity_type,
    mappingId: mapping.id,
    changedAt: params.changedAt,
    previousValue,
    newValue,
  });

  return {
    payload,
    idempotencyKey: `external_mapping_changed:${mapping.id}:${params.changedAt}`,
  };
}

