import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import type { PortableContributor } from './portableContributorRegistry';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS, CO_MANAGED_PORTABLE_OPERATIONAL_IDENTITIES, CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES,
  type CoManagedPortableOperationalRecords, type CoManagedPortableOperationalTable } from './portableOperationalCatalog';

/** The marker the time-source seam reports for operational (non-billable) time. */
export const CO_MANAGED_OPERATIONAL_BILLING_MODE = 'operational';

export interface PortableTimeEntryCandidate { entry_id: string; work_item_id: string | null; work_item_type: string | null }
/** Classifies ONE entry. Anything other than exactly `'operational'` is dropped. */
export type PortableBillingModeClassifier = (tenant: string, userId: string, entry: PortableTimeEntryCandidate) => Promise<string | undefined>;

/** Default classifier: the L6a1 time-source seam, loaded lazily so the
 * co-managed package has no static dependency on scheduling. The seam has no
 * bulk verb, and a direct `billing_mode` SQL probe is forbidden, so every
 * candidate goes through `entries.billingMode`. Native time answers
 * `'commercial'`, so a tenant without an operational provider exports no time. */
export const seamBillingModeClassifier: PortableBillingModeClassifier = async (tenant, userId, entry) => {
  const { resolveTimeSource } = await import('@alga-psa/scheduling/lib/timeSource');
  const source = await resolveTimeSource({ tenant, userId, workItemType: entry.work_item_type, workItemId: entry.work_item_id });
  const answer = await source.entries.billingMode({ tenant, userId, workItemType: entry.work_item_type, workItemId: entry.work_item_id }, entry.entry_id);
  return answer.handled ? answer.value : undefined;
};

type Rows = Record<string, unknown>[];
const CHUNK = 1000, LIMIT = 100_000;
const TIME_TABLES: readonly CoManagedPortableOperationalTable[] = ['time_entries', 'time_sheets', 'time_sheet_comments', 'time_entry_change_requests'];

export function validateCoManagedPortableOperationalRecords(input: unknown): asserts input is CoManagedPortableOperationalRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS,
    identities: CO_MANAGED_PORTABLE_OPERATIONAL_IDENTITIES, references: CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES });
}

async function inChunks(ids: readonly string[], read: (part: string[]) => Promise<Rows>): Promise<Rows> {
  const rows: Rows = [];
  for (let offset = 0; offset < ids.length; offset += CHUNK) rows.push(...await read(ids.slice(offset, offset + CHUNK)));
  if (rows.length > LIMIT) throw new Error('Portable operational record limit exceeded');
  return rows;
}

async function retainCoManagedPortableOperational(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string,
  classify: PortableBillingModeClassifier) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    for (const resource of ['timesheet', 'user_schedule']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableOperationalRecords;
    const columns = CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS;
    const read = async (table: CoManagedPortableOperationalTable, order: string[] = [columns[table][0]]): Promise<Rows> => {
      const query = own.table(table).select(...columns[table]);
      for (const column of order) query.orderBy(column);
      const rows = await query.limit(LIMIT + 1).forShare();
      if (rows.length > LIMIT) throw new Error('Portable operational record limit exceeded');
      return rows;
    };

    // Time: identifiers only, no billing_mode predicate. The seam decides, and
    // anything it does not positively call operational is not exported.
    const candidates: PortableTimeEntryCandidate[] = await own.table('time_entries').orderBy('entry_id').limit(LIMIT + 1).forShare()
      .select('entry_id', 'work_item_id', 'work_item_type');
    if (candidates.length > LIMIT) throw new Error('Portable operational record limit exceeded');
    const kept: string[] = [];
    for (const candidate of candidates) {
      if (await classify(verified.tenant, verified.userId, candidate) === CO_MANAGED_OPERATIONAL_BILLING_MODE) kept.push(candidate.entry_id);
    }
    records.time_entries = await inChunks(kept, part => own.table('time_entries').whereIn('entry_id', part).orderBy('entry_id')
      .select(...columns.time_entries).forShare());
    const sheetIds = [...new Set(records.time_entries.map(row => row.time_sheet_id).filter((id): id is string => typeof id === 'string'))].sort();
    records.time_sheets = await inChunks(sheetIds, part => own.table('time_sheets').whereIn('id', part).orderBy('id').select(...columns.time_sheets).forShare());
    records.time_sheet_comments = await inChunks(sheetIds, part => own.table('time_sheet_comments').whereIn('time_sheet_id', part)
      .orderBy('comment_id').select(...columns.time_sheet_comments).forShare());
    const keptSet = new Set(kept);
    records.time_entry_change_requests = (await inChunks(sheetIds, part => own.table('time_entry_change_requests').whereIn('time_sheet_id', part)
      .orderBy('change_request_id').select(...columns.time_entry_change_requests).forShare()))
      .filter(row => row.time_entry_id === null || keptSet.has(String(row.time_entry_id)));
    const periodIds = [...new Set(records.time_sheets.map(row => row.period_id).filter((id): id is string => typeof id === 'string'))].sort();
    records.time_periods = await inChunks(periodIds, part => own.table('time_periods').whereIn('period_id', part).orderBy('period_id')
      .select(...columns.time_periods).forShare());
    // Definitions: calendars, business hours and SLA policy carry no billing.
    records.time_period_settings = await read('time_period_settings');
    records.time_period_types = await read('time_period_types');
    records.schedule_entries = await read('schedule_entries');
    records.schedule_entry_assignees = await read('schedule_entry_assignees', ['entry_id', 'user_id']);
    records.user_work_schedules = await read('user_work_schedules', ['user_id', 'day_of_week', 'start_time']);
    for (const table of ['business_hours_schedules', 'business_hours_entries', 'holidays', 'sla_policies', 'sla_policy_targets',
      'sla_notification_thresholds'] as const) records[table] = await read(table);
    records.sla_settings = await read('sla_settings', ['created_at']);
    validateCoManagedPortableOperationalRecords(records);

    const exclusions = [{ class: 'commercial', name: 'time_entries_billing',
      reason: `${candidates.length - kept.length} of ${candidates.length} time entries were not classified operational by the time-source seam and are excluded with their billing, invoicing and approval linkage.` }];
    if (!kept.length) exclusions.push({ class: 'commercial', name: 'time_domain_empty',
      reason: 'No operational time entries exist for this tenant (a native tenant has none); time sheets, comments and change requests follow the kept entries and are empty.' });
    return { records: JSON.parse(JSON.stringify(records)) as PortableRecords,
      annotations: { exclusions, timeTables: TIME_TABLES, scheduleHistory: 'excluded', restorePolicy: { sponsorship: 'none', runningClocks: 'none' } } };
  });
}

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
/** The classifier is injectable so tests (and an L6a2 operational provider) can
 * answer without registering a global time source. */
export function createPortableOperationalContributor(classify: PortableBillingModeClassifier = seamBillingModeClassifier): PortableContributor {
  return {
    id: 'operational', version: 1, reason: 'customer-owned operational time, schedules, business hours and SLA policy',
    columns: CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS, references: CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES,
    export: async ctx => {
      if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
      const actor = snapshotCoManagedSessionActor(ctx.actor);
      if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
      // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
      return portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => retainCoManagedPortableOperational(trx, actor, ctx.packageId, classify));
    },
    retain: ctx => retainCoManagedPortableOperational(ctx.trx, ctx.actor, ctx.packageId, classify),
    validate: records => validateCoManagedPortableOperationalRecords(records),
  };
}

export const portableOperationalContributor: PortableContributor = createPortableOperationalContributor();
