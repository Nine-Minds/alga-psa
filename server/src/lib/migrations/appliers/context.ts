import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import { MigrationLedger } from '../MigrationLedger';
import type { MigrationJobConfiguration } from '../types';

/**
 * Shared state for one application run. Reference resolution goes through the
 * identity ledger — package_record_id → staged source key → applied target —
 * so it survives worker restarts and resumed runs.
 */
export class ApplierContext {
  private readonly referenceCache = new Map<string, string | null>();

  constructor(
    readonly tenant: string,
    readonly migrationJobId: string,
    readonly attempt: number,
    readonly actorUserId: string,
    readonly configuration: MigrationJobConfiguration,
    readonly ledger: MigrationLedger
  ) {}

  /**
   * Resolve a package reference to the Alga entity id it was applied as, or
   * null when the referenced record has not been applied (e.g. it failed in
   * an earlier phase).
   */
  async resolveReference(
    trx: Knex.Transaction,
    entityType: AmpEntityType,
    packageRecordId: string
  ): Promise<string | null> {
    const cacheKey = `${entityType}:${packageRecordId}`;
    const cached = this.referenceCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const db = tenantDb(trx, this.tenant);
    const staged = await db
      .table('migration_staged_records')
      .where({
        migration_job_id: this.migrationJobId,
        entity_type: entityType,
        package_record_id: packageRecordId,
      })
      .first();
    if (!staged) {
      this.referenceCache.set(cacheKey, null);
      return null;
    }

    const mapping = await this.ledger.findMapping(trx, {
      namespace: staged.namespace,
      entityType,
      sourceRecordId: staged.source_record_id,
    });
    const targetId = mapping?.targetEntityId ?? null;
    this.referenceCache.set(cacheKey, targetId);
    return targetId;
  }

  /**
   * Resolve a source client name against this tenant's existing clients. Used
   * by a single-sheet contacts import, which carries a client name rather than
   * an in-package reference. Returns null when no client matches; the caller
   * falls back to the configured default and records a diagnostic.
   */
  async resolveClientByName(trx: Knex.Transaction, name: string): Promise<string | null> {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    const db = tenantDb(trx, this.tenant);
    const row = await db
      .table('clients')
      .whereRaw('LOWER(client_name) = ?', [normalized])
      .select('client_id')
      .first();
    return row?.client_id ?? null;
  }
}
