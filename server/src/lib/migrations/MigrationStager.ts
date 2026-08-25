import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { AMP_ENTITY_TABLES, type AmpEntityType } from '@alga-psa/migration-spec';
import {
  AmpSqliteReader,
  validateAmpPackage,
  type AmpDiagnostic,
  type AmpValidationResult,
} from '@alga-psa/migration-sdk';
import { migrationPhaseFor } from './types';

const STAGING_BATCH_SIZE = 500;

export interface StagingResult {
  validation: AmpValidationResult;
  stagedCounts: Partial<Record<AmpEntityType, number>>;
  /** True when validation produced blocking diagnostics; nothing was staged. */
  rejected: boolean;
}

/**
 * Copies allowlisted package rows into Postgres staging. The package is fully
 * validated first; an invalid package stages nothing and the job is rejected.
 * After staging, retries and application read Postgres — never the file — so
 * they are deterministic even if object storage is briefly unavailable.
 */
export class MigrationStager {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async stage(migrationJobId: string, packagePath: string): Promise<StagingResult> {
    const validation = validateAmpPackage(packagePath);
    const stagedCounts: Partial<Record<AmpEntityType, number>> = {};

    if (!validation.valid || !validation.manifest) {
      await withTransaction(this.knex, async (trx) => {
        const db = tenantDb(trx, this.tenant);
        await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
          state: 'rejected',
          error: summarizeDiagnostics(validation.diagnostics),
          manifest: validation.manifest ? JSON.stringify(validation.manifest) : null,
          updated_at: trx.fn.now(),
        });
        // Keep the full diagnostics retrievable after the upload response is
        // gone; a rejected job must stay explainable from its detail view.
        await db
          .table('migration_reports')
          .where({ migration_job_id: migrationJobId, report_type: 'inspection' })
          .delete();
        await db.table('migration_reports').insert({
          tenant: this.tenant,
          migration_job_id: migrationJobId,
          report_type: 'inspection',
          summary: JSON.stringify({ diagnostics: validation.diagnostics }),
        });
      });
      return { validation, stagedCounts, rejected: true };
    }

    const manifest = validation.manifest;
    const reader = new AmpSqliteReader(packagePath);
    try {
      await withTransaction(this.knex, async (trx) => {
        const db = tenantDb(trx, this.tenant);

        const job = await db
          .table('migration_jobs')
          .where({ migration_job_id: migrationJobId })
          .first();
        if (!job) {
          throw new Error(`Migration job ${migrationJobId} was not found in this tenant`);
        }

        // Staging is idempotent per job: restage replaces prior staging.
        await db.table('migration_staged_records').where({ migration_job_id: migrationJobId }).delete();
        await db.table('migration_job_entities').where({ migration_job_id: migrationJobId }).delete();

        const presentTables = reader.tableNames();
        for (const entityType of AMP_ENTITY_TABLES) {
          if (!presentTables.includes(entityType)) {
            continue;
          }
          let staged = 0;
          let batch: Record<string, unknown>[] = [];

          const flush = async () => {
            if (batch.length === 0) {
              return;
            }
            await db.table('migration_staged_records').insert(
              batch.map((row) => ({
                tenant: this.tenant,
                migration_job_id: migrationJobId,
                entity_type: entityType,
                package_record_id: String(row.package_record_id),
                source_record_id: String(row.source_record_id),
                namespace: String(row.external_identifier_namespace),
                payload: JSON.stringify(row),
                source_created_at: (row.created_at as string | null) ?? null,
                source_updated_at: (row.updated_at as string | null) ?? null,
                validation_state: 'valid',
                validation_errors: '[]',
              }))
            );
            staged += batch.length;
            batch = [];
          };

          for (const row of reader.readRows(entityType, STAGING_BATCH_SIZE)) {
            batch.push(row);
            if (batch.length >= STAGING_BATCH_SIZE) {
              await flush();
            }
          }
          await flush();

          stagedCounts[entityType] = staged;
          await db.table('migration_job_entities').insert({
            tenant: this.tenant,
            migration_job_id: migrationJobId,
            entity_type: entityType,
            phase: migrationPhaseFor(entityType),
            state: 'pending',
            planned_count: staged,
          });
        }

        await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
          state: 'needs_configuration',
          package_id: manifest.package_id,
          format_version: manifest.format_version,
          producer_name: manifest.producer_name,
          producer_version: manifest.producer_version,
          source_system: manifest.source_system,
          manifest: JSON.stringify(manifest),
          error: null,
          updated_at: trx.fn.now(),
        });
      });
    } finally {
      reader.close();
    }

    return { validation, stagedCounts, rejected: false };
  }
}

function summarizeDiagnostics(diagnostics: AmpDiagnostic[]): string {
  const head = diagnostics.slice(0, 5).map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  const remainder = diagnostics.length - head.length;
  return remainder > 0 ? `${head.join(' | ')} (+${remainder} more)` : head.join(' | ');
}
