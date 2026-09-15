import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import type {
  MigrationOutcomeRecord,
  MigrationOutcomeSummary,
  MigrationSkipProvenance,
  PreflightResult,
} from './types';

/**
 * Builds operator-facing reports from the plan and the outcome ledger. All
 * report text is treated as untrusted display data by the UI; this service
 * only assembles rows.
 */
export class MigrationReportService {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async getPreflightReport(migrationJobId: string): Promise<PreflightResult | null> {
    const db = tenantDb(this.knex, this.tenant);
    const row = await db
      .table('migration_reports')
      .where({ migration_job_id: migrationJobId, report_type: 'preflight' })
      .first();
    if (!row) {
      return null;
    }
    return (typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary) as PreflightResult;
  }

  async getOutcomeSummary(migrationJobId: string): Promise<MigrationOutcomeSummary[]> {
    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table('migration_record_outcomes as o')
      .join('migration_staged_records as s', function join() {
        this.on('s.tenant', 'o.tenant').andOn(
          's.migration_staged_record_id',
          'o.migration_staged_record_id'
        );
      })
      .where('o.migration_job_id', migrationJobId)
      .groupBy('s.entity_type', 'o.action')
      .select('s.entity_type', 'o.action')
      .count({ count: '*' });

    const byEntity = new Map<AmpEntityType, MigrationOutcomeSummary>();
    for (const row of rows) {
      const entityType = row.entity_type as AmpEntityType;
      const summary =
        byEntity.get(entityType) ?? { entityType, created: 0, skipped: 0, failed: 0 };
      if (row.action === 'created') {
        summary.created = Number(row.count);
      } else if (row.action === 'skipped') {
        summary.skipped = Number(row.count);
      } else if (row.action === 'failed') {
        summary.failed = Number(row.count);
      }
      byEntity.set(entityType, summary);
    }
    return [...byEntity.values()];
  }

  async getOutcomeRecords(
    migrationJobId: string,
    options: { entityType?: AmpEntityType; action?: 'created' | 'skipped' | 'failed'; limit?: number } = {}
  ): Promise<MigrationOutcomeRecord[]> {
    const db = tenantDb(this.knex, this.tenant);
    const currentPackageSha256 = await this.packageSha256(migrationJobId);
    let query = db
      .table('migration_record_outcomes as o')
      .join('migration_staged_records as s', function join() {
        this.on('s.tenant', 'o.tenant').andOn(
          's.migration_staged_record_id',
          'o.migration_staged_record_id'
        );
      })
      // A skip's identity mapping is the one whose source key matches the
      // staged record; its job names the migration that already claimed it.
      .leftJoin('migration_identity_mappings as m', function join() {
        this.on('m.tenant', 's.tenant')
          .andOn('m.namespace', 's.namespace')
          .andOn('m.entity_type', 's.entity_type')
          .andOn('m.source_record_id', 's.source_record_id');
      })
      .leftJoin('migration_jobs as cj', function join() {
        this.on('cj.tenant', 'm.tenant').andOn('cj.migration_job_id', 'm.migration_job_id');
      })
      .where('o.migration_job_id', migrationJobId)
      .orderBy(['s.entity_type', 's.package_record_id', 'o.attempt'])
      .limit(options.limit ?? 1000)
      .select(
        'o.migration_staged_record_id',
        's.entity_type',
        's.package_record_id',
        's.source_record_id',
        'o.attempt',
        'o.action',
        'o.target_entity_type',
        'o.target_entity_id',
        'o.errors',
        'o.created_at',
        'm.migration_job_id as claimed_by_job_id',
        'cj.source_file_name as claimed_by_source_file_name',
        'cj.package_sha256 as claimed_by_package_sha256'
      );
    if (options.entityType) {
      query = query.where('s.entity_type', options.entityType);
    }
    if (options.action) {
      query = query.where('o.action', options.action);
    }
    const rows = await query;
    return rows.map((row) => ({
      stagedRecordId: row.migration_staged_record_id,
      entityType: row.entity_type,
      packageRecordId: row.package_record_id,
      sourceRecordId: row.source_record_id,
      attempt: Number(row.attempt),
      action: row.action,
      targetEntityType: row.target_entity_type,
      targetEntityId: row.target_entity_id,
      errors: typeof row.errors === 'string' ? JSON.parse(row.errors) : (row.errors ?? []),
      createdAt: new Date(row.created_at).toISOString(),
      claimedBy: this.claimFor(row, migrationJobId, currentPackageSha256),
    }));
  }

  /**
   * Groups this job's skipped records by the prior migration that claimed
   * them, so the results copy can name where a skip came from instead of
   * assuming it was the same package.
   */
  async getSkipProvenance(migrationJobId: string): Promise<MigrationSkipProvenance> {
    const db = tenantDb(this.knex, this.tenant);
    const currentPackageSha256 = await this.packageSha256(migrationJobId);
    const rows = await db
      .table('migration_record_outcomes as o')
      .join('migration_staged_records as s', function join() {
        this.on('s.tenant', 'o.tenant').andOn(
          's.migration_staged_record_id',
          'o.migration_staged_record_id'
        );
      })
      .leftJoin('migration_identity_mappings as m', function join() {
        this.on('m.tenant', 's.tenant')
          .andOn('m.namespace', 's.namespace')
          .andOn('m.entity_type', 's.entity_type')
          .andOn('m.source_record_id', 's.source_record_id');
      })
      .leftJoin('migration_jobs as cj', function join() {
        this.on('cj.tenant', 'm.tenant').andOn('cj.migration_job_id', 'm.migration_job_id');
      })
      .where('o.migration_job_id', migrationJobId)
      .where('o.action', 'skipped')
      .groupBy('m.migration_job_id', 'cj.source_file_name', 'cj.package_sha256')
      .select(
        'm.migration_job_id as claimed_by_job_id',
        'cj.source_file_name as claimed_by_source_file_name',
        'cj.package_sha256 as claimed_by_package_sha256'
      )
      .count({ count: '*' });

    const entries = rows.map((row) => ({
      migrationJobId: row.claimed_by_job_id ?? null,
      sourceFileName: row.claimed_by_source_file_name ?? null,
      skippedCount: Number(row.count),
      samePackage: this.samePackage(row, migrationJobId, currentPackageSha256),
    }));
    const skippedCount = entries.reduce((total, entry) => total + entry.skippedCount, 0);
    return {
      allSamePackage: entries.every((entry) => entry.samePackage),
      skippedCount,
      entries,
    };
  }

  private async packageSha256(migrationJobId: string): Promise<string | null> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db
      .table('migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .select('package_sha256')
      .first();
    return (job?.package_sha256 as string | null) ?? null;
  }

  private samePackage(
    row: Record<string, unknown>,
    currentJobId: string,
    currentPackageSha256: string | null
  ): boolean {
    const claimingJobId = row.claimed_by_job_id ?? null;
    if (claimingJobId === currentJobId) {
      return true;
    }
    const claimingSha = row.claimed_by_package_sha256 ?? null;
    return Boolean(currentPackageSha256 && claimingSha === currentPackageSha256);
  }

  private claimFor(
    row: Record<string, unknown>,
    currentJobId: string,
    currentPackageSha256: string | null
  ) {
    if (row.action !== 'skipped' || !row.claimed_by_job_id) {
      return null;
    }
    return {
      migrationJobId: String(row.claimed_by_job_id as string),
      sourceFileName: (row.claimed_by_source_file_name as string | null) ?? null,
      samePackage: this.samePackage(row, currentJobId, currentPackageSha256),
    };
  }

  /** CSV rendering shared by preflight and outcome downloads. */
  toCsv(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) {
      return '';
    }
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n');
  }
}
