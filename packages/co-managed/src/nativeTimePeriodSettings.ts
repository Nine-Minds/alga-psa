import type { Knex } from 'knex';
import { tenantDb, withTransaction, lockTimePeriodCalendar, timePeriodCalendarDate } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';

export class NativeTimePeriodSettingsError extends Error {
  constructor(readonly code: 'SETTINGS_INVALID' | 'SETTINGS_NOT_FOUND' | 'SETTINGS_OVERLAP') {
    super({ SETTINGS_INVALID: 'Invalid time period settings', SETTINGS_NOT_FOUND: 'Time period settings not found', SETTINGS_OVERLAP: 'The specified time period overlaps with existing time periods' }[code]);
    this.name = 'NativeTimePeriodSettingsError';
  }
}

const components = ['start_day', 'end_day', 'start_month', 'end_month', 'start_day_of_month', 'end_day_of_month'] as const;
const writable = ['frequency', 'frequency_unit', 'is_active', 'effective_from', 'effective_to', ...components];
const hidden = (fields: readonly string[], names: string[]) => isNativeTimeFieldHidden(fields,
  names.flatMap(name => [name, `settings.${name}`, `time_period_settings.${name}`]));

function settingsView(row: any, fields: readonly string[], complete = false) {
  if (hidden(fields, ['tenant', 'time_period_settings_id', 'settings_id', 'frequency', 'frequency_unit', 'is_active', 'effective_from']) ||
      (complete && hidden(fields, writable))) throw new CoManagedSharedWorkError();
  const view: any = {};
  for (const field of ['tenant', 'time_period_settings_id', ...writable, 'created_at', 'updated_at']) {
    if (hidden(fields, [field]) || row[field] == null) continue;
    view[field] = ['effective_from', 'effective_to', 'created_at', 'updated_at'].includes(field) ? new Date(row[field]).toISOString() : row[field];
  }
  return view;
}

/** Normalize the legacy API's frequency labels and native count/unit model at
 * the domain edge. Store one canonical shape, including explicit null clears. */
function normalizeSettings(input: Record<string, any>, existing?: any) {
  const values: any = Object.fromEntries(writable.filter(field => input[field] !== undefined).map(field => [field, input[field]]));
  const legacy: Record<string, [string, number]> = { daily: ['day', 1], weekly: ['week', 1], monthly: ['month', 1], quarterly: ['month', 3], yearly: ['year', 1], custom: ['day', 1] };
  if (typeof values.frequency === 'string') {
    const mapping = legacy[values.frequency], count = values.frequency_unit ?? 1;
    if (!mapping || typeof count !== 'number') throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
    values.frequency = count * mapping[1]; values.frequency_unit = mapping[0];
  } else if (typeof values.frequency_unit === 'number') {
    // A legacy partial count update retains the stored calendar unit.
    if (!existing || values.frequency !== undefined) throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
    values.frequency = values.frequency_unit; delete values.frequency_unit;
  }
  const result: any = { frequency: 1, is_active: true, effective_from: new Date().toISOString().slice(0, 10), effective_to: null,
    start_day: 1, end_day: 0, start_month: 1, end_month: 12, start_day_of_month: 1, end_day_of_month: 0, ...Object.fromEntries(Object.entries(existing ?? {}).filter(([, value]) => value != null)), ...values };
  if (!Number.isSafeInteger(result.frequency) || result.frequency < 1 || result.frequency > 2147483647 || !['day', 'week', 'month', 'year'].includes(result.frequency_unit) || typeof result.is_active !== 'boolean') throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
  const integer = (field: string, min: number, max: number) => Number.isSafeInteger(result[field]) && result[field] >= min && result[field] <= max;
  if (result.frequency_unit === 'week' && (!integer('start_day', 1, 7) || !integer('end_day', 0, 7))) throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
  if (result.frequency_unit === 'month' && (!integer('start_day', 1, 31) || !integer('end_day', 0, 31) || (result.end_day !== 0 && result.end_day <= result.start_day))) throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
  if (result.frequency_unit === 'year' && (!integer('start_month', 1, 12) || !integer('end_month', 1, 12) || !integer('start_day_of_month', 1, 31) || !integer('end_day_of_month', 0, 31))) throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
  try {
    result.effective_from = timePeriodCalendarDate(result.effective_from);
    result.effective_to = result.effective_to == null ? null : timePeriodCalendarDate(result.effective_to);
  } catch { throw new NativeTimePeriodSettingsError('SETTINGS_INVALID'); }
  if (result.effective_to && result.effective_from >= result.effective_to) throw new NativeTimePeriodSettingsError('SETTINGS_INVALID');
  // Year-only components remain absent for other units. The legacy schema
  // requires start/end day values even when those fields are not applicable.
  if (result.frequency_unit === 'day') { result.start_day = 1; result.end_day = 0; }
  if (result.frequency_unit !== 'year') for (const field of ['start_month', 'end_month', 'start_day_of_month', 'end_day_of_month']) result[field] = null;
  if (result.frequency_unit === 'year') { result.start_day = 1; result.end_day = 0; }
  return Object.fromEntries(writable.map(field => [field, result[field]]));
}

function cyclesOverlap(left: any, right: any) {
  if (left.frequency_unit !== right.frequency_unit) return true;
  if (['month', 'year'].includes(left.frequency_unit) && (left.frequency > 1 || right.frequency > 1)) return true;
  if (left.frequency_unit === 'month') {
    const aEnd = left.end_day || 32, bEnd = right.end_day || 32;
    return left.start_day < bEnd && right.start_day < aEnd;
  }
  if (left.frequency_unit === 'year') {
    const aStart = left.start_month * 32 + left.start_day_of_month, bStart = right.start_month * 32 + right.start_day_of_month;
    const aEnd = left.end_month * 32 + (left.end_day_of_month || 32), bEnd = right.end_month * 32 + (right.end_day_of_month || 32);
    const segments = (start: number, end: number) => end <= start ? [[start, 13 * 32], [32, end]] : [[start, end]];
    return segments(aStart, aEnd).some(([start, end]) => segments(bStart, bEnd).some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end));
  }
  return true;
}

export async function readCoManagedNativeTimePeriodSettings(db: Knex, tenant: string, identify: () => Promise<CoManagedAuthenticatedActor>,
  options: { activeOnly?: boolean; complete?: boolean } = {}
): Promise<{ handled: false } | { handled: true; settings: any[] }> {
  if (!isCoManagedUuid(tenant)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_period', 'read', true)) throw new CoManagedSharedWorkError();
    const query = tenantDb(trx, tenant).table('time_period_settings').orderBy('effective_from', 'desc').orderBy('time_period_settings_id').forShare();
    if (options.activeOnly) query.where('is_active', true);
    const settings: Record<string, unknown>[] = [];
    for (const row of await query) {
      try {
        const policy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', { id: row.time_period_settings_id });
        settings.push(settingsView(row, policy.redactedFields, options.complete));
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError) || options.complete) throw error; }
    }
    await credential.assertCurrent();
    return { handled: true, settings };
  });
}

export async function commandCoManagedNativeTimePeriodSettings(db: Knex, tenant: string,
  input: { action: 'create' | 'update' | 'delete'; id?: string; settings?: Record<string, any> }, identify: () => Promise<CoManagedAuthenticatedActor>
): Promise<{ handled: false } | { handled: true; settings?: any }> {
  if (!isCoManagedUuid(tenant) || !['create', 'update', 'delete'].includes(input.action) || (input.action !== 'create' && !isCoManagedUuid(input.id))) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    await assertCoManagedOperationalWrite(trx, tenant); await lockTimePeriodCalendar(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()), owner = tenantDb(trx, tenant);
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), record = input.id ? { id: input.id } : {};
    const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', record);
    const write = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'manage', record);
    const fields = [...read.redactedFields, ...write.redactedFields];
    if (hidden(fields, ['tenant', 'time_period_settings_id', 'settings_id', ...writable])) throw new CoManagedSharedWorkError();
    const existing = input.action === 'create' ? undefined : await owner.table('time_period_settings').where('time_period_settings_id', input.id).forUpdate().first();
    if (input.action !== 'create' && !existing) throw new NativeTimePeriodSettingsError('SETTINGS_NOT_FOUND');
    let settings;
    if (input.action === 'delete') await owner.table('time_period_settings').where('time_period_settings_id', input.id).del();
    else {
      const values = normalizeSettings(input.settings ?? {}, existing);
      if (values.is_active) {
        const candidates = owner.table('time_period_settings').where('is_active', true).where(query => query.whereNull('effective_to').orWhere('effective_to', '>', values.effective_from));
        if (values.effective_to) candidates.where('effective_from', '<', values.effective_to);
        if (input.id) candidates.whereNot('time_period_settings_id', input.id);
        if ((await candidates.forShare()).some(row => cyclesOverlap(values, row))) throw new NativeTimePeriodSettingsError('SETTINGS_OVERLAP');
      }
      const [row] = input.action === 'create' ? await owner.table('time_period_settings').insert({ ...values, tenant, created_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*') :
        await owner.table('time_period_settings').where('time_period_settings_id', input.id).update({ ...values, updated_at: trx.fn.now() }).returning('*');
      const response = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_period', 'read', { id: row.time_period_settings_id });
      settings = settingsView(row, [...fields, ...response.redactedFields]);
    }
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true, settings };
  });
}
