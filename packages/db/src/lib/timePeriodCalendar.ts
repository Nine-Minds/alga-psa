import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

export class TimePeriodCalendarError extends Error {
  constructor(readonly code: 'PERIOD_INVALID_DATES' | 'PERIOD_OVERLAP' | 'PERIOD_IN_USE' | 'PERIOD_NOT_FOUND' | 'PERIOD_CURRENT') {
    super({ PERIOD_INVALID_DATES: 'Enter valid start and end dates.', PERIOD_OVERLAP: 'Cannot create time period: overlaps with existing period',
      PERIOD_IN_USE: 'Cannot remove a period that has timesheets', PERIOD_NOT_FOUND: 'Time period not found', PERIOD_CURRENT: 'Cannot remove the current period' }[code]);
    this.name = 'TimePeriodCalendarError';
  }
}

export function timePeriodCalendarDate(input: unknown): string {
  if (input instanceof Date && !Number.isFinite(input.getTime())) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
  const value = input instanceof Date ? input.toISOString() : String(input ?? '');
  const day = value.slice(0, 10), parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ||
      (value.length > 10 && !Number.isFinite(Date.parse(value)))) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
  return day;
}

/** Acquire before period row locks and overlap/emptiness checks. An explicit
 * tenant row serializes even an empty calendar without upgrading tenant locks. */
export async function lockTimePeriodCalendar(trx: Knex.Transaction, tenant: string) {
  if (!trx.isTransaction) throw new Error('Time period calendar writes require a transaction');
  const locks = tenantDb(trx, tenant).table('time_period_calendar_locks');
  await locks.clone().insert({ tenant }).onConflict('tenant').ignore();
  await locks.forUpdate().first('tenant');
}

export async function insertTimePeriodCalendar(trx: Knex.Transaction, tenant: string, input: Array<{ start_date: unknown; end_date: unknown }>) {
  await lockTimePeriodCalendar(trx, tenant);
  const periods = input.map(period => ({ start_date: timePeriodCalendarDate(period.start_date), end_date: timePeriodCalendarDate(period.end_date) }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (periods.some(period => period.start_date >= period.end_date)) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
  if (periods.some((period, index) => index && periods[index - 1].end_date > period.start_date)) throw new TimePeriodCalendarError('PERIOD_OVERLAP');
  const owner = tenantDb(trx, tenant);
  for (const period of periods) {
    if (await owner.table('time_periods').where('start_date', '<', period.end_date).where('end_date', '>', period.start_date).first('period_id')) throw new TimePeriodCalendarError('PERIOD_OVERLAP');
  }
  if (!periods.length) return [];
  return owner.table('time_periods').insert(periods.map(period => ({ tenant, ...period }))).returning('*');
}

export async function updateTimePeriodCalendar(trx: Knex.Transaction, tenant: string, id: string, input: { start_date?: unknown; end_date?: unknown }) {
  await lockTimePeriodCalendar(trx, tenant);
  const owner = tenantDb(trx, tenant), period = await owner.table('time_periods').where('period_id', id).forUpdate().first();
  if (!period) throw new TimePeriodCalendarError('PERIOD_NOT_FOUND');
  const start = timePeriodCalendarDate(input.start_date ?? period.start_date), end = timePeriodCalendarDate(input.end_date ?? period.end_date);
  if (start >= end) throw new TimePeriodCalendarError('PERIOD_INVALID_DATES');
  if (await owner.table('time_sheets').where('period_id', id).first('id')) throw new TimePeriodCalendarError('PERIOD_IN_USE');
  if (await owner.table('time_periods').whereNot('period_id', id).where('start_date', '<', end).where('end_date', '>', start).first('period_id')) throw new TimePeriodCalendarError('PERIOD_OVERLAP');
  const [updated] = await owner.table('time_periods').where('period_id', id).update({ start_date: start, end_date: end }).returning('*');
  return updated;
}

export async function deleteTimePeriodCalendar(trx: Knex.Transaction, tenant: string, id: string, preserveDate?: string) {
  await lockTimePeriodCalendar(trx, tenant);
  const owner = tenantDb(trx, tenant), period = await owner.table('time_periods').where('period_id', id).forUpdate().first();
  if (!period) throw new TimePeriodCalendarError('PERIOD_NOT_FOUND');
  // A sheet FK insert retains this actual period, so the check runs after any
  // concurrent sheet creation commits and cannot race a successful deletion.
  if (await owner.table('time_sheets').where('period_id', id).first('id')) throw new TimePeriodCalendarError('PERIOD_IN_USE');
  if (preserveDate && timePeriodCalendarDate(period.start_date) <= preserveDate && timePeriodCalendarDate(period.end_date) > preserveDate) throw new TimePeriodCalendarError('PERIOD_CURRENT');
  await owner.table('time_periods').where('period_id', id).del();
}
