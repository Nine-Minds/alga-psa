import { getConnection } from '@/lib/db/db';
import { createHash } from 'crypto';

export interface ExternalMappingPayload {
  tenantId: string;
  assetId: string;
  importJobId: string;
  importSourceId: string;
  externalId: string;
  sourceHash: string;
  metadata?: Record<string, unknown>;
}

const orderObjectKeys = (input: Record<string, unknown>): Record<string, unknown> => {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const value = input[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        acc[key] = orderObjectKeys(value as Record<string, unknown>);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
};

/**
 * Deterministically hash a source record so we can detect changes on future imports.
 */
export const computeRecordHash = (record: Record<string, unknown>): string => {
  const hash = createHash('sha256');
  const ordered = orderObjectKeys(record);
  hash.update(JSON.stringify(ordered));
  return hash.digest('hex');
};

export class ExternalEntityMappingRepository {
  async upsertMapping(payload: ExternalMappingPayload): Promise<void> {
    const knex = await getConnection(payload.tenantId);

    const metadata = {
      ...(payload.metadata ?? {}),
      importJobId: payload.importJobId,
      recordedAt: new Date().toISOString()
    };

    await knex('external_entity_mappings')
      .insert({
        tenant: payload.tenantId,
        asset_id: payload.assetId,
        import_source_id: payload.importSourceId,
        external_id: payload.externalId,
        external_hash: payload.sourceHash,
        metadata,
        last_synced_at: knex.fn.now()
      })
      .onConflict(['tenant', 'import_source_id', 'external_id'])
      .merge({
        asset_id: payload.assetId,
        external_hash: payload.sourceHash,
        metadata,
        last_synced_at: knex.fn.now()
      });
  }
}
