import type { Knex } from 'knex';
import { tenantDb, withTransaction, lockTimePeriodCalendar, insertTimePeriodCalendar, updateTimePeriodCalendar, deleteTimePeriodCalendar, timePeriodCalendarDate, TimePeriodCalendarError } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';

export async function retainCoManagedTimeCalendar(trx: Knex.Transaction, tenant: string) {
  await getCoManagedOperationalState(trx, tenant);
  const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (workspace?.product_code !== 'co_managed' && !await owner.table('time_entries').where('billing_mode', 'operational').first('entry_id') && !await hasCoManagedConversationOwnership(trx, tenant)) return false;
  if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
  return true;
}

function periodView(period: any, fields: readonly string[]) {
  const hidden = (names: string[]) => isNativeTimeFieldHidden(fields, names.flatMap(name => [name, `time_periods.${name}`]));
  if (hidden(['tenant', 'period_id', 'start_date', 'end_date'])) throw new CoManagedSharedWorkError();
  const view: any = Object.fromEntries(Object.entries(period).filter(([key]) => !hidden([key])));
  view.start_date = timePeriodCalendarDate(period.start_date); view.end_date = timePeriodCalendarDate(period.end_date);
  for (const field of ['created_at', 'updated_at']) if (view[field]) view[field] = new Date(view[field]).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  if (!hidden(['is_current'])) view.is_current = view.start_date <= today && view.end_date > today;
  if (!hidden(['duration_days'])) view.duration_days = (Date.parse(view.end_date) - Date.parse(view.start_date)) / 86400000;
  return view;
}

export async function readCoManagedNativeTimePeriods(db: Knex, tenant: string, identify: () => Promise<CoManagedAuthenticatedActor>,
  options: { id?: string; date?: string; latest?: boolean } = {}
): Promise<{ handled: false } | { handled: true; periods: any[] }> {
  if (!isCoManagedUuid(tenant) || (options.id && !isCoManagedUuid(options.id))) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_period', 'read', true)) throw new CoManagedSharedWorkError();
    const query = tenantDb(trx, tenant).table('time_periods').orderBy('end_date', 'desc').orderBy('period_id').forShare();
    if (options.id) query.where('period_id', options.id);
    if (options.date) { const date = timePeriodCalendarDate(options.date); query.where('start_date', '<=', date).where('end_date', '>', date); }
    const rows = await query, periods: any[] = [];
    for (const row of rows) {
      try {
        const policy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', { id: row.period_id });
        periods.push(periodView(row, policy.redactedFields));
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError) || options.id) throw error; }
    }
    await credential.assertCurrent();
    return { handled: true, periods: options.latest ? periods.slice(0, 1) : periods };
  });
}

type CalendarDates = Array<{ start_date: unknown; end_date: unknown }>;
type CalendarCommand = { action: 'create'; periods: CalendarDates | ((trx: Knex.Transaction) => Promise<CalendarDates>) } |
  { action: 'update'; id: string; dates: { start_date?: unknown; end_date?: unknown } } |
  { action: 'delete'; id: string; preserveDate?: string };

export async function commandCoManagedNativeTimePeriods(db: Knex, tenant: string, input: CalendarCommand,
  identify: () => Promise<CoManagedAuthenticatedActor>
): Promise<{ handled: false } | { handled: true; periods: any[] }> {
  if (!isCoManagedUuid(tenant) || !['create', 'update', 'delete'].includes(input.action) || (input.action !== 'create' && !isCoManagedUuid(input.id))) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    await assertCoManagedOperationalWrite(trx, tenant);
    await lockTimePeriodCalendar(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    const record = input.action === 'create' ? {} : { id: input.id };
    const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', record);
    const write = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', input.action, record);
    const fields = [...read.redactedFields, ...write.redactedFields];
    if (isNativeTimeFieldHidden(fields, ['tenant', 'period_id', 'start_date', 'end_date', 'time_periods.start_date', 'time_periods.end_date'])) throw new CoManagedSharedWorkError();
    const periods = input.action === 'create' ? await insertTimePeriodCalendar(trx, tenant, typeof input.periods === 'function' ? await input.periods(trx) : input.periods) :
      input.action === 'update' ? [await updateTimePeriodCalendar(trx, tenant, input.id, input.dates)] :
      (await deleteTimePeriodCalendar(trx, tenant, input.id, input.preserveDate), []);
    const views: Record<string, unknown>[] = [];
    for (const period of periods) {
      const policy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', { id: period.period_id });
      views.push(periodView(period, [...fields, ...policy.redactedFields]));
    }
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true, periods: views };
  });
}

/** Full periods use half-open boundaries: the next start equals the previous
 * end. Month/year endpoints retain the original day anchor when clamping. */
export function generateTimePeriodCalendar(input: { start_date?: string; end_date?: string; frequency: string; frequency_unit?: number }) {
  const start = timePeriodCalendarDate(input.start_date), end = timePeriodCalendarDate(input.end_date), unit = input.frequency_unit ?? 1;
  if (start >= end || !Number.isSafeInteger(unit) || unit < 1 || !['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(input.frequency)) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
  const anchor = new Date(`${start}T00:00:00Z`), periods: Array<{ start_date: string; end_date: string }> = [];
  let current = start;
  for (let index = 1; index <= 1000; index++) {
    const next = new Date(anchor);
    if (['daily', 'weekly', 'custom'].includes(input.frequency)) next.setUTCDate(next.getUTCDate() + index * unit * (input.frequency === 'weekly' ? 7 : 1));
    else {
      next.setUTCDate(1); next.setUTCMonth(anchor.getUTCMonth() + index * unit * (input.frequency === 'quarterly' ? 3 : input.frequency === 'yearly' ? 12 : 1));
      const last = new Date(next); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
      next.setUTCDate(Math.min(anchor.getUTCDate(), last.getUTCDate()));
    }
    if (!Number.isFinite(next.getTime())) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
    const boundary = next.toISOString().slice(0, 10);
    if (boundary > end) return periods;
    periods.push({ start_date: current, end_date: boundary }); current = boundary;
    if (boundary === end) return periods;
  }
  throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
}
