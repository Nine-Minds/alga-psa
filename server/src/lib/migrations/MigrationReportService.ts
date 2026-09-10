import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import type { MigrationOutcomeRecord, MigrationOutcomeSummary, PreflightResult } from './types';

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
    let query = db
      .table('migration_record_outcomes as o')
      .join('migration_staged_records as s', function join() {
        this.on('s.tenant', 'o.tenant').andOn(
          's.migration_staged_record_id',
          'o.migration_staged_record_id'
        );
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
        'o.created_at'
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
    }));
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
