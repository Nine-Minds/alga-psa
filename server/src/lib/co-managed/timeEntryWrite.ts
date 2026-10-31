import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import { computeWorkDateFields, resolveUserTimeZone, tenantDb, truncateToMinute } from '@alga-psa/db';
import { toPlainDate } from '@alga-psa/core';
import type { IUser } from '@alga-psa/types';
import { assertHumanWorkAssignee, assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { resolveTimeEntryContract } from '@alga-psa/scheduling/lib/timeEntryContract';
import { assertCanActOnBehalf } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';
import type { PersistedTimeEntry } from '@alga-psa/scheduling/lib/timeEntryWriteCore';
import {
  CoManagedSharedWorkError, operationalTimeEntryFields, recordCoManagedWorkReference, loadCoManagedLocalWorkReference,
  serviceRequiredForTimeEntry, TimeEntryBillingModeError, type CoManagedTimeEntryMode, type CoManagedLocalWorkReference,
} from '@alga-psa/co-managed';

/** The subset of a time entry the provider writes. Anything else on the raw input is ignored. */
export interface CoManagedTimeEntryInput {
  entry_id?: string | null;
  work_item_id: string;
  work_item_type: string;
  start_time: string | Date;
  end_time: string | Date;
  billable_duration?: number;
  notes?: string;
  user_id?: string;
  time_sheet_id?: string;
  approval_status?: string;
  service_id?: string | null;
  contract_line_id?: string | null;
  tax_region?: string | null;
  tax_rate_id?: string | null;
}

export interface CoManagedTimeWriteInput {
  tenant: string;
  actor: IUser;
  entry: CoManagedTimeEntryInput;
  mode: CoManagedTimeEntryMode;
  /** Required for MSP `co_managed` entries (already admitted by the caller). */
  reference?: CoManagedLocalWorkReference & { billingProfileId?: string | null };
  /** Descriptive evidence admitted with the write; stored on the provenance row. */
  evidence?: { title?: string | null; ticketNumber?: string | null };
  /** The tenant participates: gates the one conditional `service_id` rule. */
  participates: boolean;
}

const EDITABLE = new Set(['DRAFT', 'CHANGES_REQUESTED']);

/**
 * The write the native core cannot do (it has no `billing_mode` and no work-reference). It mirrors the
 * native core's subject, sheet, period and duration rules and nothing else: no bucket draw (a
 * co_managed/operational work item resolves to no client there), no ticket/task resource side effects.
 *
 * - commercial `co_managed`: needs a service; contract line resolves through the MSP's client/profile.
 * - operational: no service, contract line, tax or billable minutes; never invoiced.
 */
export async function writeCoManagedTimeEntry(trx: Knex.Transaction, input: CoManagedTimeWriteInput): Promise<PersistedTimeEntry> {
  const { tenant, actor, entry, mode } = input;
  const db = tenantDb(trx, tenant) as any;
  const existing = entry.entry_id
    ? await db.table('time_entries').where({ entry_id: entry.entry_id }).forUpdate().first('user_id', 'invoiced', 'billing_mode', 'work_item_id', 'work_item_type')
    : null;
  if (entry.entry_id && !existing) throw new Error(`Original time entry with ID ${entry.entry_id} not found for update.`);
  if (existing?.invoiced) throw new Error('This time entry has already been invoiced and cannot be modified.');
  // The mode and the work identity are fixed at creation: an operational note is never retro-billed, and
  // a billed entry never moves to other work.
  if (existing && ((existing.billing_mode ?? 'commercial') !== mode || existing.work_item_id !== entry.work_item_id || existing.work_item_type !== entry.work_item_type)) {
    throw new Error('A time entry cannot change its billing mode or work item.');
  }
  if (serviceRequiredForTimeEntry({ participates: input.participates, mode }) && !entry.service_id?.trim()) throw new Error('Service is required for time entries');

  const userId = existing?.user_id ?? entry.user_id ?? actor.user_id;
  await assertCanActOnBehalf(actor, tenant, userId, trx);
  if (!entry.entry_id) {
    if (entry.user_id) await assertHumanWorkAssignee(trx, tenant, [entry.user_id]);
    else await assertHumanWorkOwner(trx, tenant, actor.user_id, 'user_id');
  }

  const startDate = truncateToMinute(entry.start_time), endDate = truncateToMinute(entry.end_time);
  const actualMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  if (!(actualMinutes > 0)) throw new Error('Validation failed: end time must be after start time');
  const timeZone = await resolveUserTimeZone(trx, tenant, userId);
  const { work_date, work_timezone } = computeWorkDateFields(startDate.toISOString(), timeZone);
  const { work_date: endWorkDate } = computeWorkDateFields(endDate.toISOString(), timeZone);

  const sheetIds = new Set<string>(entry.time_sheet_id ? [entry.time_sheet_id] : []);
  if (entry.entry_id) { const original = await db.table('time_entries').where({ entry_id: entry.entry_id }).first('time_sheet_id'); if (original?.time_sheet_id) sheetIds.add(original.time_sheet_id); }
  for (const sheetId of Array.from(sheetIds).sort()) {
    const sheet = await db.table('time_sheets').where({ id: sheetId }).forUpdate().first('approval_status', 'user_id');
    if (!sheet) throw new Error('Time sheet not found');
    if (!EDITABLE.has(sheet.approval_status)) throw new Error(sheetId === entry.time_sheet_id ? 'Time sheet is not editable' : 'Original time sheet is not editable');
    if (sheetId === entry.time_sheet_id && sheet.user_id !== userId) throw new Error('Time entry user does not match time sheet owner');
  }
  if (entry.time_sheet_id) {
    const periodQuery = db.table('time_sheets');
    db.tenantJoin(periodQuery, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');
    const period = await periodQuery.where({ 'time_sheets.id': entry.time_sheet_id }).first('time_periods.start_date', 'time_periods.end_date');
    if (!period) throw new Error('Time sheet not found');
    const periodStart = toPlainDate(period.start_date).toString(), periodEnd = toPlainDate(period.end_date).toString();
    if ([work_date, endWorkDate].some(date => date < periodStart || date >= periodEnd)) throw new Error('Time entry must fall within the time period for the time sheet');
  }

  let commercial: Record<string, unknown>;
  let finalBillableDuration: number;
  if (mode === 'operational') {
    commercial = operationalTimeEntryFields(entry);
    finalBillableDuration = 0;
  } else {
    // Same rule as the native core: an explicit 0 stays 0, otherwise the stated or actual minutes.
    finalBillableDuration = entry.billable_duration === 0 ? 0 : (typeof entry.billable_duration === 'number' && entry.billable_duration > 0 ? entry.billable_duration : actualMinutes);
    let contractLineId = entry.contract_line_id ?? null, source: string | null = contractLineId ? 'explicit' : null;
    if (!contractLineId && entry.service_id) {
      const resolved = await resolveTimeEntryContract({ serviceId: entry.service_id, effectiveDate: work_date || startDate,
        getBillingContext: async () => ({ clientId: input.reference?.clientId ?? null, billingProfileId: input.reference?.billingProfileId ?? null }) });
      contractLineId = resolved.contractLineId; source = resolved.source;
    }
    commercial = { billing_mode: 'commercial', service_id: entry.service_id, contract_line_id: contractLineId, contract_line_source: source,
      tax_region: entry.tax_region ?? null, tax_rate_id: entry.tax_rate_id ?? null, billable_duration: finalBillableDuration };
  }
  if (input.mode === 'commercial' && entry.work_item_type === 'co_managed' && !input.reference) throw new CoManagedSharedWorkError();

  const row = { work_item_id: entry.work_item_id, work_item_type: entry.work_item_type, start_time: formatISO(startDate), end_time: formatISO(endDate),
    work_date, work_timezone, notes: entry.notes ?? '', time_sheet_id: entry.time_sheet_id, approval_status: entry.approval_status ?? 'DRAFT',
    user_id: userId, updated_by: actor.user_id, updated_at: new Date().toISOString(), ...commercial };
  let saved: any;
  if (entry.entry_id) {
    const { user_id: _owner, ...update } = row;
    [saved] = await db.table('time_entries').where({ entry_id: entry.entry_id }).update(update).returning('*');
  } else {
    [saved] = await db.table('time_entries').insert({ ...row, tenant, entry_id: uuidv4(), created_at: new Date().toISOString(), created_by: actor.user_id }).returning('*');
    if (input.reference) await recordCoManagedWorkReference(trx, tenant, saved.entry_id, input.reference, input.evidence);
  }
  if (!saved?.entry_id) throw new Error('Time entry save completed without a saved row.');
  return { entry: saved, isUpdate: !!entry.entry_id, finalBillableDuration,
    searchEvent: { eventType: entry.entry_id ? 'TIME_ENTRY_UPDATED' : 'TIME_ENTRY_CREATED',
      payload: { tenantId: tenant, timeEntryId: saved.entry_id, userId: saved.user_id, workItemId: saved.work_item_id, workItemType: saved.work_item_type } } } as PersistedTimeEntry;
}

export { loadCoManagedLocalWorkReference, TimeEntryBillingModeError };
