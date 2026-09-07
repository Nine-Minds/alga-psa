import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction, computeWorkDateFields, resolveUserTimeZone, truncateToMinute } from '@alga-psa/db';
import { productTimeEntryMode, type TimeEntryBillingMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeSource, isNativeTimeFieldHidden, type CoManagedNativeTimeAccess } from './nativeTimeEntryAccess';
import { operationalTimeEntryFields } from './timeEntryBillingMode';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

const TABLE = 'native_time_tracking_sessions';
export class NativeTimeTrackingError extends Error {
  constructor(readonly code: 'TIMER_NOT_FOUND' | 'TIMER_ALREADY_ACTIVE' | 'TIMER_STOP_CONFLICT' | 'TIMER_INVALID_INPUT' | 'TIMER_SERVICE_REQUIRED') { super(code); this.name = 'NativeTimeTrackingError'; }
}
export interface NativeTimeTrackingStart { work_item_id?: string; work_item_type: string; notes?: string; service_id?: string }
export interface NativeTimeTrackingStop { end_time?: string; notes?: string; service_id?: string; is_billable?: boolean }
export interface NativeTimeTrackingCompletion {
  trx: Knex.Transaction; actor: CoManagedAuthenticatedActor; clock: any; endTime: Date;
  billingMode: TimeEntryBillingMode; serviceId?: string; notes: string; billable: boolean;
}
function stopCommand(input: NativeTimeTrackingStop) {
  let end: Date | null = null;
  try { if (input.end_time != null) end = truncateToMinute(input.end_time); }
  catch { throw new NativeTimeTrackingError('TIMER_INVALID_INPUT'); }
  const data = { end_time: end?.toISOString() ?? null, notes: input.notes ?? null,
    service_id: input.service_id ?? null, is_billable: input.is_billable ?? null };
  if ((data.notes != null && typeof data.notes !== 'string') || (data.service_id != null && !isCoManagedUuid(data.service_id)) ||
    (data.is_billable != null && typeof data.is_billable !== 'boolean')) throw new NativeTimeTrackingError('TIMER_INVALID_INPUT');
  return { data, hash: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
function source(clock: any) {
  return { entry_id: clock.session_id, user_id: clock.user_id, work_item_type: clock.work_item_type,
    work_item_id: clock.work_item_id || '__non_billable__', approval_status: 'DRAFT' };
}
async function now(trx: Knex.Transaction): Promise<Date> {
  return (await trx.raw("SELECT date_trunc('minute', clock_timestamp()) AS instant")).rows[0].instant;
}
async function withTimerIdentity<T>(db: Knex, inputActor: CoManagedAuthenticatedActor, exclusive: boolean,
  work: (trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, mode: TimeEntryBillingMode) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedAuthenticatedActor(inputActor);
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, actor.tenant);
    const owner = tenantDb(trx, actor.tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const mode = workspace && productTimeEntryMode(workspace.product_code);
    if (!mode || workspace.suspended_at) throw new CoManagedSharedWorkError();
    const user = owner.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false });
    if (exclusive) user.forUpdate(); else user.forShare();
    if (!await user.first('user_id')) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    const result = await work(trx, actor, mode);
    await credential.assertCurrent();
    return result;
  });
}
function assertVisibleClock(access: CoManagedNativeTimeAccess) {
  if (isNativeTimeFieldHidden(access.redactedTimeFields, ['session_id', 'entry_id', 'tenant', 'user_id', 'work_item_id', 'work_item_type',
    'start_time', 'end_time', 'work_date', 'work_timezone', 'billing_mode', 'created_at', 'duration', 'elapsed_minutes', 'duration_hours'])) throw new CoManagedSharedWorkError();
}
function presentCompletedEntry(entry: any, access: CoManagedNativeTimeAccess) {
  assertVisibleClock(access);
  const result = { ...entry };
  const financial = new Set(['service_id', 'service', 'service_name', 'tax_region', 'tax_rate_id', 'contract_line_id', 'billable_duration', 'is_billable', 'invoiced']);
  for (const field of Object.keys(result)) {
    const aliases = [field, ...(financial.has(field) ? ['billing'] : []), ...(field === 'is_billable' ? ['billable_duration'] : [])];
    if (isNativeTimeFieldHidden(access.redactedTimeFields, aliases)) result[field] = field === 'notes' ? '' : null;
  }
  if (isNativeTimeFieldHidden(access.redactedTimeFields, ['work_item', 'work_item_title'])) {
    result.work_item = null; result.work_item_title = '';
  }
  return result;
}
async function presentClock(trx: Knex.Transaction, clock: any, access: CoManagedNativeTimeAccess) {
  assertVisibleClock(access);
  const hidden = (fields: string[]) => isNativeTimeFieldHidden(access.redactedTimeFields, fields);
  const current = await now(trx);
  const serviceVisible = !hidden(['service', 'service_id', 'service_name', 'billing']);
  const service = clock.service_id && serviceVisible ? await tenantDb(trx, clock.tenant).table('service_catalog').where('service_id', clock.service_id).forShare().first('service_name') : null;
  return { session_id: clock.session_id, entry_id: clock.session_id, tenant: clock.tenant, user_id: clock.user_id, billing_mode: clock.billing_mode,
    work_item_id: clock.work_item_id, work_item_type: clock.work_item_type, start_time: clock.start_time,
    work_date: clock.work_date instanceof Date ? clock.work_date.toISOString().slice(0, 10) : clock.work_date, work_timezone: clock.work_timezone,
    notes: hidden(['notes']) ? '' : clock.notes, service_id: serviceVisible ? clock.service_id : null, service_name: service?.service_name,
    created_at: clock.created_at, status: 'active', elapsed_minutes: Math.max(0, Math.round((current.getTime() - new Date(clock.start_time).getTime()) / 60000)),
    work_item_title: hidden(['work_item', 'work_item_title']) ? '' : access.workItem.name };
}

export async function startNativeTimeTracking(db: Knex, actor: CoManagedAuthenticatedActor, input: NativeTimeTrackingStart) {
  input = { ...input };
  if (input.notes != null && typeof input.notes !== 'string') throw new NativeTimeTrackingError('TIMER_INVALID_INPUT');
  return withTimerIdentity(db, actor, true, async (trx, home, mode) => {
    await assertCoManagedOperationalWrite(trx, home.tenant);
    const owner = tenantDb(trx, home.tenant);
    if (await owner.table(TABLE).where('user_id', home.userId).whereNull('completed_entry_id').first('session_id')) throw new NativeTimeTrackingError('TIMER_ALREADY_ACTIVE');
    if (mode === 'operational') operationalTimeEntryFields(input);
    else if (!isCoManagedUuid(input.service_id) || !await owner.table('service_catalog').where('service_id', input.service_id).forShare().first('service_id')) throw new NativeTimeTrackingError('TIMER_SERVICE_REQUIRED');
    const sessionId = (await trx.raw('SELECT gen_random_uuid() AS id')).rows[0].id;
    const start = await now(trx), zone = await resolveUserTimeZone(trx, home.tenant, home.userId);
    const fields = { tenant: home.tenant, session_id: sessionId, user_id: home.userId, work_item_id: input.work_item_id || null,
      work_item_type: input.work_item_type, start_time: start, ...computeWorkDateFields(start, zone), billing_mode: mode,
      service_id: mode === 'operational' ? null : input.service_id, notes: input.notes || '' };
    const access = await admitCoManagedNativeTimeSource(trx, home, source(fields), 'create');
    const [clock] = await owner.table(TABLE).insert(fields).returning('*');
    const result = await presentClock(trx, clock, access); await access.assertCurrent(); return result;
  });
}

export async function getNativeActiveTimeTracking(db: Knex, actor: CoManagedAuthenticatedActor) {
  return withTimerIdentity(db, actor, false, async (trx, home) => {
    const clock = await tenantDb(trx, home.tenant).table(TABLE).where('user_id', home.userId).whereNull('completed_entry_id').forShare().first();
    if (!clock) return null;
    const access = await admitCoManagedNativeTimeSource(trx, home, source(clock), 'read');
    const result = await presentClock(trx, clock, access); await access.assertCurrent(); return result;
  });
}

/** The callback uses the existing completed-time engine inside this transaction.
 * The immutable receipt makes a second stop a read, never another insertion. */
export async function stopNativeTimeTracking(db: Knex, actor: CoManagedAuthenticatedActor, sessionId: string, input: NativeTimeTrackingStop,
  complete: (context: NativeTimeTrackingCompletion) => Promise<any>) {
  if (!isCoManagedUuid(sessionId)) throw new NativeTimeTrackingError('TIMER_NOT_FOUND');
  const command = stopCommand(input);
  return withTimerIdentity(db, actor, true, async (trx, home) => {
    const owner = tenantDb(trx, home.tenant), clock = await owner.table(TABLE).where({ session_id: sessionId, user_id: home.userId }).forUpdate().first();
    if (!clock) throw new NativeTimeTrackingError('TIMER_NOT_FOUND');
    if (clock.completed_entry_id) {
      if (clock.stop_request_hash !== command.hash) throw new NativeTimeTrackingError('TIMER_STOP_CONFLICT');
      const hint = await owner.table('time_entries').where({ entry_id: clock.completed_entry_id, user_id: home.userId }).first();
      if (!hint) throw new NativeTimeTrackingError('TIMER_NOT_FOUND');
      const access = await admitCoManagedNativeTimeSource(trx, home, { ...source(clock), work_item_id: hint.work_item_id || '__non_billable__', work_item_type: hint.work_item_type }, 'read');
      const entry = await owner.table('time_entries').where({ entry_id: clock.completed_entry_id, user_id: home.userId }).forShare().first();
      if (!entry || entry.work_item_id !== hint.work_item_id || entry.work_item_type !== hint.work_item_type) throw new CoManagedSharedWorkError();
      assertVisibleClock(access);
      const result = { ...entry, notes: isNativeTimeFieldHidden(access.redactedTimeFields, ['notes']) ? '' : entry.notes, work_item_title: access.workItem.name, work_item: { id: entry.work_item_id, type: entry.work_item_type, title: access.workItem.name },
        duration_hours: Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000 / 60 * 100) / 100, is_billable: entry.billable_duration > 0 };
      await access.assertCurrent(); return presentCompletedEntry(result, access);
    }
    await assertCoManagedOperationalWrite(trx, home.tenant);
    const access = await admitCoManagedNativeTimeSource(trx, home, source(clock), 'update');
    assertVisibleClock(access);
    const endTime = command.data.end_time ? new Date(command.data.end_time) : await now(trx);
    if (endTime < new Date(clock.start_time)) throw new NativeTimeTrackingError('TIMER_INVALID_INPUT');
    if (clock.billing_mode === 'operational') operationalTimeEntryFields({ service_id: command.data.service_id });
    const serviceId = clock.billing_mode === 'operational' ? undefined : command.data.service_id ?? clock.service_id;
    if (clock.billing_mode === 'commercial' && (!isCoManagedUuid(serviceId) || !await owner.table('service_catalog').where('service_id', serviceId).forShare().first('service_id'))) throw new NativeTimeTrackingError('TIMER_SERVICE_REQUIRED');
    const result = await complete({ trx, actor: home, clock, endTime, billingMode: clock.billing_mode, serviceId,
      notes: command.data.notes ?? clock.notes, billable: clock.billing_mode === 'commercial' && command.data.is_billable !== false });
    if (result?.entry_id !== clock.session_id) throw new NativeTimeTrackingError('TIMER_STOP_CONFLICT');
    await owner.table(TABLE).where('session_id', sessionId).update({ completed_entry_id: result.entry_id, stopped_at: endTime,
      stop_request_hash: command.hash, notes: '', updated_at: trx.fn.now() });
    await access.assertCurrent(); return presentCompletedEntry(result, access);
  });
}
