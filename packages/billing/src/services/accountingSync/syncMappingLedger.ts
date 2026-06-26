import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Thin knex helpers over tenant_external_entity_mappings — the single ledger
 * of what is linked to the external accounting system and whether the two
 * sides still agree.
 */

const TABLE = 'tenant_external_entity_mappings';

export interface ExternalEntityMappingRow {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export class SyncMappingLedger {
  constructor(
    private readonly knex: Knex,
    private readonly tenantId: string,
    private readonly integrationType: string
  ) {}

  private table<Row extends object = ExternalEntityMappingRow>() {
    return tenantDb(this.knex, this.tenantId).table<Row>(TABLE);
  }

  async findByExternalId(
    algaEntityType: string,
    externalEntityId: string,
    targetRealm?: string | null
  ): Promise<ExternalEntityMappingRow | undefined> {
    const query = this.table<ExternalEntityMappingRow>()
      .where({
        tenant: this.tenantId,
        integration_type: this.integrationType,
        alga_entity_type: algaEntityType,
        external_entity_id: externalEntityId
      });

    if (targetRealm) {
      query.andWhere((builder) => {
        builder.where('external_realm_id', targetRealm).orWhereNull('external_realm_id');
      });
    }

    return query.first();
  }

  async findByAlgaId(
    algaEntityType: string,
    algaEntityId: string
  ): Promise<ExternalEntityMappingRow | undefined> {
    return this.table<ExternalEntityMappingRow>()
      .where({
        tenant: this.tenantId,
        integration_type: this.integrationType,
        alga_entity_type: algaEntityType,
        alga_entity_id: algaEntityId
      })
      .first();
  }

  async insert(params: {
    algaEntityType: string;
    algaEntityId: string;
    externalEntityId: string;
    targetRealm?: string | null;
    syncStatus?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ExternalEntityMappingRow> {
    const [row] = await this.table<ExternalEntityMappingRow>()
      .insert({
        tenant: this.tenantId,
        integration_type: this.integrationType,
        alga_entity_type: params.algaEntityType,
        alga_entity_id: params.algaEntityId,
        external_entity_id: params.externalEntityId,
        external_realm_id: params.targetRealm ?? null,
        sync_status: params.syncStatus ?? 'synced',
        last_synced_at: this.knex.fn.now() as unknown as string,
        metadata: params.metadata ?? null
      } as any)
      .returning('*');

    return row;
  }

  async update(
    id: string,
    patch: {
      syncStatus?: string;
      metadata?: Record<string, unknown> | null;
      touchSyncedAt?: boolean;
    }
  ): Promise<void> {
    const update: Record<string, unknown> = { updated_at: this.knex.fn.now() };
    if (patch.syncStatus !== undefined) {
      update.sync_status = patch.syncStatus;
    }
    if (patch.metadata !== undefined) {
      update.metadata = patch.metadata;
    }
    if (patch.touchSyncedAt) {
      update.last_synced_at = this.knex.fn.now();
    }

    await this.table()
      .where({ tenant: this.tenantId, id })
      .update(update);
  }

  /** Counts by sync_status for the health panel. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.table()
      .where({ tenant: this.tenantId, integration_type: this.integrationType })
      .select('sync_status')
      .count<{ sync_status: string | null; count: string }[]>('* as count')
      .groupBy('sync_status');

    return Object.fromEntries(rows.map((row) => [row.sync_status ?? 'unknown', Number(row.count)]));
  }

  /** Bind the same ledger to a transaction. */
  withKnex(knex: Knex): SyncMappingLedger {
    return new SyncMappingLedger(knex, this.tenantId, this.integrationType);
  }
}
