import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import type {
  CatalogPricePlan,
  CatalogPriceReportRow,
  MigrationOutcomeRecord,
  MigrationOutcomeSummary,
  MigrationSkipProvenance,
  PreflightResult,
} from './types';
import { CATALOG_PRICE_OUTCOME_PREFIX, SKU_MATCH_WARNING_PREFIX } from './types';
import { sourceRowOf } from './catalogPricePlan';

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

  /** The row-level price plan the last preflight stored; null before a preflight. */
  async getCatalogPricePlan(migrationJobId: string): Promise<CatalogPricePlan | null> {
    const db = tenantDb(this.knex, this.tenant);
    const row = await db
      .table('migration_reports')
      .where({ migration_job_id: migrationJobId, report_type: 'catalog_price_plan' })
      .first();
    if (!row) return null;
    return (typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary) as CatalogPricePlan;
  }

  /**
   * Price outcomes in upload row order: what each row did (created / updated /
   * unchanged / blocked:<code> / failed), with the old and new rate and the
   * currency. A row skipped because an earlier run of the same file already
   * applied it reports `unchanged (already applied)`.
   */
  async getPriceReport(migrationJobId: string): Promise<CatalogPriceReportRow[]> {
    const db = tenantDb(this.knex, this.tenant);
    const plan = await this.getCatalogPricePlan(migrationJobId);
    const planByRecord = new Map((plan?.rows ?? []).map((row) => [row.packageRecordId, row]));
    const staged = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId, entity_type: 'catalog_prices' })
      .select('migration_staged_record_id', 'package_record_id', 'source_record_id', 'validation_state', 'validation_errors', 'payload');
    const outcomes = await db
      .table('migration_record_outcomes')
      .where({ migration_job_id: migrationJobId })
      .whereIn('migration_staged_record_id', staged.map((row: any) => row.migration_staged_record_id))
      .orderBy('attempt', 'asc')
      .select('migration_staged_record_id', 'action', 'errors', 'warnings');
    const latest = new Map<string, any>();
    for (const outcome of outcomes as any[]) latest.set(outcome.migration_staged_record_id, outcome);

    const rows: CatalogPriceReportRow[] = staged.map((record: any) => {
      const payload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
      const planned = planByRecord.get(record.package_record_id);
      const base: CatalogPriceReportRow = {
        sourceRow: sourceRowOf(record.source_record_id),
        currency: payload.currency ?? planned?.currency ?? null,
        itemName: planned?.itemName ?? payload.name ?? null,
        itemKind: planned?.itemKind ?? payload.item_kind ?? null,
        result: 'pending',
        oldRateMinor: planned?.currentRateMinor ?? null,
        newRateMinor: payload.rate_minor ?? null,
        message: null,
      };
      const outcome = latest.get(record.migration_staged_record_id);
      if (outcome) {
        const errors = this.parseWarnings(outcome.errors);
        const detail = this.parseWarnings(outcome.warnings)
          .filter((w) => w.startsWith(CATALOG_PRICE_OUTCOME_PREFIX))
          .map((w) => JSON.parse(w.slice(CATALOG_PRICE_OUTCOME_PREFIX.length)))[0];
        if (outcome.action === 'failed') {
          // A row the applier refused with a price code is reported as blocked, like the planner's.
          const coded = /^(CATALOG_PRICE_[A-Z_]+): /.exec(errors[0] ?? '');
          return coded
            ? { ...base, result: `blocked:${coded[1]}`, message: errors[0].slice(coded[0].length) }
            : { ...base, result: 'failed', message: errors.join('; ') || null };
        }
        if (detail) {
          const already = outcome.action === 'skipped' && detail.message === 'Already applied.';
          return {
            ...base,
            result: already ? 'unchanged (already applied)' : detail.outcome,
            currency: detail.currency ?? base.currency,
            itemName: detail.itemName ?? base.itemName,
            itemKind: detail.itemKind ?? base.itemKind,
            oldRateMinor: detail.oldRateMinor ?? null,
            newRateMinor: detail.newRateMinor ?? base.newRateMinor,
            message: detail.message ?? null,
          };
        }
        // Skipped by the ledger: an earlier run of the same file applied it.
        return { ...base, result: 'unchanged (already applied)', message: 'Already applied.' };
      }
      if (record.validation_state === 'blocked') {
        const reasons = typeof record.validation_errors === 'string' ? JSON.parse(record.validation_errors) : record.validation_errors ?? [];
        const first = reasons[0] ?? {};
        return { ...base, result: `blocked:${first.code ?? 'BLOCKED'}`, message: first.message ?? null };
      }
      if (planned?.alreadyApplied) return { ...base, result: 'unchanged (already applied)', message: planned.message };
      return base;
    });
    return rows.sort((a, b) => a.sourceRow - b.sourceRow || (a.currency ?? '').localeCompare(b.currency ?? ''));
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
        'o.warnings',
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
      matchReason: this.parseWarnings(row.warnings).some((w) => w.startsWith(SKU_MATCH_WARNING_PREFIX))
        ? ('sku_match' as const)
        : null,
    };
  }

  private parseWarnings(raw: unknown): string[] {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
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
