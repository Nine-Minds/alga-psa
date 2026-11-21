'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { featureFlags } from '@alga-psa/core/server';
import { minorUnitsToDecimalText } from '@alga-psa/core/formatters';
import { PRICE_BOOK_FEATURE_FLAG } from '@alga-psa/billing/lib/catalog/priceBookFlag';
import { previewCatalogPriceChanges } from '@alga-psa/billing/lib/catalog/previewCatalogPriceChanges';
import { getPriceBook } from '@alga-psa/billing/lib/catalog/priceBooks';
import { executeMigrationJob, preflightMigrationJob } from './migrationActions';
import { MigrationReportService } from './MigrationReportService';
import { parseConfiguration } from './MigrationPlanner';
import type {
  CatalogPriceOutcome,
  CatalogPricePlanRow,
  CatalogPriceReportRow,
  MigrationJobConfiguration,
  PreflightIssue,
} from './types';

/**
 * Server actions behind the Price books import dialog. Each one re-checks the
 * flag and the permissions of docs/plans/2026-11-18-pricebooks-csv-import.md §7:
 *  - preview: import_export:manage + billing:read (the preview reveals contract rates);
 *  - apply: import_export:manage + service:update, plus service:create when the job creates items.
 * The applier checks service:update / service:create again, because the run is asynchronous.
 */

export type PriceBookImportError = { error: string };

async function authorize(requirements: Array<[string, string]>): Promise<{ tenant: string; userId: string } | PriceBookImportError> {
  const user = await getCurrentUser();
  if (!user?.tenant) return { error: 'No authenticated user found' };
  if (!(await featureFlags.isEnabled(PRICE_BOOK_FEATURE_FLAG, { userId: user.user_id, tenantId: user.tenant }))) {
    return { error: 'Price books are not enabled for this account.' };
  }
  for (const [resource, action] of requirements) {
    if (!(await hasPermission(user, resource, action))) return { error: `Permission denied: ${resource}:${action} is required.` };
  }
  return { tenant: user.tenant, userId: user.user_id };
}

/** A price row as the browser sees it: names and amounts, never item ids. */
export type PriceBookPreviewRow = Omit<CatalogPricePlanRow, 'matchedItemId'>;

export interface PriceBookImpactLine {
  key: string;
  clientName: string | null;
  contractName: string | null;
  contractLineName: string | null;
  currency: string;
  currentRateMinor: number | null;
  newRateMinor: number | null;
  reason: string | null;
  itemNames: string[];
}

export interface PriceBookImportPreview {
  state: 'ready' | 'blocked';
  issues: PreflightIssue[];
  priceBookName: string | null;
  effectiveDate: string | null;
  counts: Record<CatalogPriceOutcome, number>;
  rows: PriceBookPreviewRow[];
  impact: {
    willChange: PriceBookImpactLine[];
    custom: PriceBookImpactLine[];
    unreviewed: PriceBookImpactLine[];
    excluded: PriceBookImpactLine[];
    totalMonthlyDeltaByCurrency: Record<string, number>;
  };
  /** True when the job will create items (apply then needs service:create). */
  createsItems: boolean;
  blockedRowCount: number;
}

export async function updatePriceBookJobConfiguration(
  migrationJobId: string,
  patch: Pick<MigrationJobConfiguration, 'services' | 'products'>,
): Promise<{ success: true } | PriceBookImportError> {
  const auth = await authorize([['import_export', 'manage'], ['billing', 'read']]);
  if ('error' in auth) return auth;
  const { knex } = await createTenantKnex(auth.tenant);
  const db = tenantDb(knex, auth.tenant);
  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) return { error: 'Migration job not found' };
  if (['queued', 'applying', 'completed', 'completed_with_errors'].includes(job.state)) return { error: `Configuration cannot change while the job is ${job.state}.` };
  const current = parseConfiguration(job.configuration);
  const next: MigrationJobConfiguration = { ...current, ...(patch.services ? { services: patch.services } : {}), ...(patch.products ? { products: patch.products } : {}) };
  await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
    configuration: JSON.stringify(next), state: 'needs_configuration', preflighted_at: null, updated_at: knex.fn.now(),
  });
  return { success: true };
}

const toImpactLine = (row: any, nameOfService: (id: string) => string): PriceBookImpactLine => ({
  key: `${row.contractLineId}`,
  clientName: row.clientName,
  contractName: row.contractName,
  contractLineName: row.contractLineName,
  currency: row.currency,
  currentRateMinor: row.currentRateCents,
  newRateMinor: row.newRateCents,
  reason: row.reason,
  itemNames: (row.serviceIds as string[]).map(nameOfService),
});

/** Runs the dry run and returns the preview. It writes nothing outside staging. */
export async function previewPriceBookImport(migrationJobId: string): Promise<PriceBookImportPreview | PriceBookImportError> {
  const auth = await authorize([['import_export', 'manage'], ['billing', 'read']]);
  if ('error' in auth) return auth;
  const preflight = await preflightMigrationJob(migrationJobId);
  const { knex } = await createTenantKnex(auth.tenant);
  const reports = new MigrationReportService(knex, auth.tenant);
  const plan = await reports.getCatalogPricePlan(migrationJobId);
  const job = await tenantDb(knex, auth.tenant).table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  const configuration = parseConfiguration(job?.configuration);
  const book = configuration.priceBook ? await getPriceBook(knex, auth.tenant, configuration.priceBook.priceBookId) : null;

  const rows = plan?.rows ?? [];
  // Contract impact: one combined preview for every changed price of existing items.
  const changes = rows
    .filter((row) => (row.outcome === 'update' || row.outcome === 'create') && row.matchedItemId && row.currency && row.newRateMinor !== null && !row.alreadyApplied)
    .map((row) => ({ serviceId: row.matchedItemId!, currency: row.currency!, newRateCents: row.newRateMinor! }));
  const nameById = new Map(rows.filter((row) => row.matchedItemId).map((row) => [row.matchedItemId!, row.itemName ?? '']));
  const nameOf = (id: string) => nameById.get(id) ?? '';
  const impact = plan?.effectiveDate && changes.length > 0
    ? await previewCatalogPriceChanges(knex, auth.tenant, changes, plan.effectiveDate)
    : null;

  const createsItems = rows.some((row) => row.outcome === 'create' && !row.matchedItemId);
  return {
    state: preflight.state,
    issues: preflight.issues,
    priceBookName: book?.name ?? null,
    effectiveDate: plan?.effectiveDate ?? book?.effective_date ?? null,
    counts: plan?.counts ?? { create: 0, update: 0, unchanged: 0, unmatched: 0, ambiguous: 0, conflict: 0, invalid: 0 },
    rows: rows.map(({ matchedItemId: _matchedItemId, ...row }) => row),
    impact: {
      willChange: (impact?.willChange ?? []).map((row) => toImpactLine(row, nameOf)),
      custom: (impact?.custom ?? []).map((row) => toImpactLine(row, nameOf)),
      unreviewed: (impact?.unreviewed ?? []).map((row) => toImpactLine(row, nameOf)),
      excluded: (impact?.excluded ?? []).map((row) => toImpactLine(row, nameOf)),
      totalMonthlyDeltaByCurrency: impact?.totalMonthlyDeltaByCurrency ?? {},
    },
    createsItems,
    blockedRowCount: rows.filter((row) => row.code !== null).length,
  };
}

/** Applies a previewed job. Blocked rows do not stop it; the job-wide blockers do. */
export async function applyPriceBookImport(migrationJobId: string): Promise<{ jobId: string } | PriceBookImportError> {
  const first = await authorize([['import_export', 'manage'], ['service', 'update']]);
  if ('error' in first) return first;
  const { knex } = await createTenantKnex(first.tenant);
  const reports = new MigrationReportService(knex, first.tenant);
  const plan = await reports.getCatalogPricePlan(migrationJobId);
  const staged = await tenantDb(knex, first.tenant)
    .table('migration_staged_records')
    .where({ migration_job_id: migrationJobId, validation_state: 'valid' })
    .whereIn('entity_type', ['products', 'services'])
    .first();
  if (staged || (plan?.rows ?? []).some((row) => row.outcome === 'create' && !row.matchedItemId)) {
    const create = await authorize([['service', 'create']]);
    if ('error' in create) return create;
  }
  return executeMigrationJob(migrationJobId);
}

export interface PriceBookImportReport {
  rows: CatalogPriceReportRow[];
  counts: Record<string, number>;
}

export async function getPriceBookImportReport(migrationJobId: string): Promise<PriceBookImportReport | PriceBookImportError> {
  const auth = await authorize([['import_export', 'manage'], ['billing', 'read']]);
  if ('error' in auth) return auth;
  const { knex } = await createTenantKnex(auth.tenant);
  const rows = await new MigrationReportService(knex, auth.tenant).getPriceReport(migrationJobId);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.result.startsWith('blocked:') ? 'blocked' : row.result.startsWith('unchanged') ? 'unchanged' : row.result;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { rows, counts };
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The price report as CSV, in upload row order, with the original row number. */
export async function getPriceBookImportReportCsv(migrationJobId: string): Promise<string | PriceBookImportError> {
  const report = await getPriceBookImportReport(migrationJobId);
  if ('error' in report) return report;
  const money = (minor: number | null, currency: string | null) =>
    minor === null || !currency ? '' : minorUnitsToDecimalText(minor, currency);
  const header = ['Row', 'Item', 'Type', 'Currency', 'Result', 'Old price', 'New price', 'Note'];
  return [
    header.join(','),
    ...report.rows.map((row) => [
      row.sourceRow, row.itemName, row.itemKind, row.currency, row.result,
      money(row.oldRateMinor, row.currency), money(row.newRateMinor, row.currency), row.message,
    ].map(csvCell).join(',')),
  ].join('\n');
}
