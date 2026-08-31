import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Thin knex helpers over tenant_external_entity_mappings — the single ledger
 * of what is linked to the external accounting system and whether the two
 * sides still agree.
 *
 * Realm-scoped lookups require an exact tenant + provider + entity-type +
 * realm match: a NULL-realm row is never a stand-in for a connected realm,
 * and unlinked (tombstoned) rows are never consumable.
 *
 * Realm semantics for the lookup methods:
 *   - `targetRealm` omitted (undefined) → no realm constraint (callers that
 *     do not care which realm a row names).
 *   - `targetRealm` is a string → exact `external_realm_id` match only.
 *   - `targetRealm` is explicitly null → only realm-less rows.
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
  deleted_at?: string | null;
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

  private applyRealmScope(
    query: Knex.QueryBuilder,
    targetRealm?: string | null
  ): Knex.QueryBuilder {
    if (targetRealm === undefined) {
      return query;
    }
    if (targetRealm === null) {
      return query.whereNull('external_realm_id');
    }
    return query.andWhere('external_realm_id', targetRealm);
  }

  async findByExternalId(
    algaEntityType: string,
    externalEntityId: string,
    targetRealm?: string | null
  ): Promise<ExternalEntityMappingRow | undefined> {
    const query = this.table<ExternalEntityMappingRow>()
      .where({
        integration_type: this.integrationType,
        alga_entity_type: algaEntityType,
        external_entity_id: externalEntityId,
      })
      .whereNull('deleted_at');

    // Realm-scoped lookups are exact matches only — no NULL-realm fallback.
    this.applyRealmScope(query, targetRealm);

    return query.first();
  }

  async findByAlgaId(
    algaEntityType: string,
    algaEntityId: string,
    targetRealm?: string | null
  ): Promise<ExternalEntityMappingRow | undefined> {
    const query = this.table<ExternalEntityMappingRow>()
      .where({
        integration_type: this.integrationType,
        alga_entity_type: algaEntityType,
        alga_entity_id: algaEntityId,
      })
      .whereNull('deleted_at');

    this.applyRealmScope(query, targetRealm);

    return query.first();
  }

  /**
   * A row for this entity that exists but is NOT consumable for the given
   * realm: it is tombstoned (unlinked) or lives in a different realm (or is
   * realm-less). Consumers use this to distinguish "never exported" from
   * "exported but unlinked/wrong-realm" so they can abort with an actionable
   * failure instead of silently acting on nothing.
   */
  async findNonConsumable(
    algaEntityType: string,
    algaEntityId: string,
    targetRealm: string
  ): Promise<ExternalEntityMappingRow | undefined> {
    return this.table<ExternalEntityMappingRow>()
      .where({
        integration_type: this.integrationType,
        alga_entity_type: algaEntityType,
        alga_entity_id: algaEntityId,
      })
      .where((builder) => {
        builder
          .whereNotNull('deleted_at')
          .orWhereNull('external_realm_id')
          .orWhereNot('external_realm_id', targetRealm);
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
    const existing = await this.findByAlgaId(
      params.algaEntityType,
      params.algaEntityId,
      params.targetRealm === undefined ? null : params.targetRealm
    );
    if (existing) {
      // Same entity already linked in this realm — idempotent relink.
      await this.update(existing.id, {
        syncStatus: params.syncStatus ?? 'synced',
        metadata: params.metadata ?? null,
        touchSyncedAt: true,
      });
      return this.table<ExternalEntityMappingRow>()
        .where({ id: existing.id })
        .first() as Promise<ExternalEntityMappingRow>;
    }

    try {
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
          metadata: params.metadata ?? null,
        } as any)
        .returning('*');

      return row;
    } catch (error) {
      // Unique-index collision on the (tenant, integration, type, entity) key
      // means a row exists that findByAlgaId did not return — most commonly a
      // tombstone from an earlier unlink. Restoring it is the explicit
      // relink-or-recreate step for the vetted onboarding/reconciliation flows.
      if ((error as { code?: string } | null)?.code === '23505') {
        const tombstoned = await this.table<ExternalEntityMappingRow>()
          .where({
            integration_type: this.integrationType,
            alga_entity_type: params.algaEntityType,
            alga_entity_id: params.algaEntityId,
          })
          .whereNotNull('deleted_at')
          .first();

        if (tombstoned) {
          await this.table()
            .where({ id: tombstoned.id })
            .update({
              external_entity_id: params.externalEntityId,
              external_realm_id: params.targetRealm ?? null,
              sync_status: params.syncStatus ?? 'synced',
              last_synced_at: this.knex.fn.now(),
              metadata: params.metadata ?? null,
              deleted_at: null,
              updated_at: this.knex.fn.now(),
            });
          return this.table<ExternalEntityMappingRow>()
            .where({ id: tombstoned.id })
            .first() as Promise<ExternalEntityMappingRow>;
        }
      }
      throw error;
    }
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
      .where({ id })
      .update(update);
  }

  /** Counts by sync_status for the health panel. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.table()
      .where({ integration_type: this.integrationType })
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
