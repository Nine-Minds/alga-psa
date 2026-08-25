import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { AMP_ENTITY_TABLES, AMP_ENTITY_REFERENCES, type AmpEntityType } from '@alga-psa/migration-spec';
import { AmpSqliteReader, validateAmpPackage, type AmpDiagnostic } from '@alga-psa/migration-sdk';

/**
 * The package is validated before a single staging row is written.  This is
 * intentionally a server-only boundary: the SDK has no tenant or Postgres
 * dependency, while this class never creates a domain entity.
 */
export class MigrationStager {
  constructor(private readonly db: Knex, private readonly tenant: string) {}

  async stage(jobId: string, packagePath: string): Promise<{ diagnostics: AmpDiagnostic[]; blocking: boolean }> {
    const result = validateAmpPackage(packagePath);
    if (!result.manifest) throw new Error('AMP_INVALID_MANIFEST: package has no usable manifest.');
    const manifest = result.manifest;
    const diagnostics = result.diagnostics;
    const reader = new AmpSqliteReader(packagePath);
    try {
      await withTransaction(this.db, async trx => {
        const scoped = tenantDb(trx, this.tenant);
        const job = await scoped.table('migration_jobs').where({ migration_job_id: jobId }).first();
        if (!job) throw new Error('Migration job was not found in this tenant.');
        await scoped.table('migration_staged_records').where({ migration_job_id: jobId }).delete();
        await scoped.table('migration_job_entities').where({ migration_job_id: jobId }).delete();
        for (const entityType of AMP_ENTITY_TABLES) {
          if (!reader.tableNames().includes(entityType)) continue;
          const rows = reader.allRows(entityType);
          if (rows.length) {
            await scoped.table('migration_staged_records').insert(rows.map(row => ({
              migration_job_id: jobId, entity_type: entityType,
              package_record_id: String(row.package_record_id), source_record_id: String(row.source_record_id),
              namespace: String(row.external_identifier_namespace), payload: JSON.stringify(row),
              validation_errors: JSON.stringify(diagnostics.filter(d => d.table === entityType && d.recordId === row.package_record_id)),
              validation_state: diagnostics.some(d => d.table === entityType && d.recordId === row.package_record_id) ? 'blocked' : 'valid',
            })));
          }
          await scoped.table('migration_job_entities').insert({ migration_job_id: jobId, entity_type: entityType, phase: phaseFor(entityType), planned_count: rows.length });
        }
        await scoped.table('migration_jobs').where({ migration_job_id: jobId }).update({
          state: !result.valid ? 'blocked' : 'needs_configuration', manifest: JSON.stringify(manifest),
          package_id: manifest.package_id, format_version: manifest.format_version,
          producer_name: manifest.producer_name, producer_version: manifest.producer_version,
          updated_at: trx.fn.now(),
        });
      });
    } finally { reader.close(); }
    return { diagnostics, blocking: !result.valid };
  }
}

/** Dry-run planner deliberately only reads staging and tenant-owned configuration. */
export class MigrationPlanner {
  constructor(private readonly db: Knex, private readonly tenant: string) {}

  async preflight(jobId: string): Promise<{ blocking: AmpDiagnostic[]; counts: Partial<Record<AmpEntityType, number>> }> {
    const scoped = tenantDb(this.db, this.tenant);
    const records = await scoped.table('migration_staged_records').where({ migration_job_id: jobId }).select('migration_staged_record_id', 'entity_type', 'package_record_id', 'payload');
    const ids = new Map<AmpEntityType, Set<string>>();
    const counts: Partial<Record<AmpEntityType, number>> = {};
    for (const row of records) {
      const type = row.entity_type as AmpEntityType;
      let typeIds = ids.get(type);
      if (!typeIds) { typeIds = new Set<string>(); ids.set(type, typeIds); }
      typeIds.add(row.package_record_id);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    const blocking: AmpDiagnostic[] = [];
    for (const row of records) {
      const type = row.entity_type as AmpEntityType; const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      for (const reference of AMP_ENTITY_REFERENCES[type]) {
        const value = payload[reference.column];
        if (value && !ids.get(reference.targetTable)?.has(value)) blocking.push({ code: 'AMP_INVALID_REFERENCE', message: `Reference ${reference.column} does not resolve in this package.`, table: type, recordId: row.package_record_id, field: reference.column });
      }
    }
    await withTransaction(this.db, async trx => {
      const tx = tenantDb(trx, this.tenant);
      for (const row of records) {
        const rowErrors = blocking.filter(error => error.table === row.entity_type && error.recordId === row.package_record_id);
        const existing = await tx.table('migration_staged_records').where({ migration_job_id: jobId, migration_staged_record_id: row.migration_staged_record_id }).first('validation_errors');
        const existingErrors = typeof existing?.validation_errors === 'string' ? JSON.parse(existing.validation_errors) : (existing?.validation_errors ?? []);
        const errors = [...existingErrors, ...rowErrors];
        await tx.table('migration_staged_records').where({ migration_job_id: jobId, migration_staged_record_id: row.migration_staged_record_id }).update({ validation_state: errors.length ? 'blocked' : 'valid', validation_errors: JSON.stringify(errors) });
      }
      await tx.table('migration_jobs').where({ migration_job_id: jobId }).update({ state: blocking.length ? 'blocked' : 'ready', preflighted_at: trx.fn.now(), updated_at: trx.fn.now() });
    });
    return { blocking, counts };
  }
}

export const MIGRATION_PHASE_ORDER: readonly AmpEntityType[] = ['organizations', 'locations', 'contacts', 'tickets', 'ticket_comments', 'assets'];
function phaseFor(entity: AmpEntityType): number { return MIGRATION_PHASE_ORDER.indexOf(entity) + 1; }
