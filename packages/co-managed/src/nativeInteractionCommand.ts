import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainScheduleSource } from './nativeScheduleRead';
import { readCoManagedNativeInteractions } from './nativeInteractionRead';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export class NativeInteractionCommandError extends Error {
  constructor(readonly code: 'INTERACTION_INVALID' | 'INTERACTION_IN_USE') {
    super(code === 'INTERACTION_IN_USE' ? 'This interaction has linked work. Change its ownership or meeting time through the linked work.' : 'Review the interaction fields and try again.');
    this.name = 'NativeInteractionCommandError';
  }
}
const writable = ['title', 'notes', 'type_id', 'user_id', 'client_id', 'contact_name_id', 'ticket_id', 'status_id', 'interaction_date', 'start_time', 'end_time', 'duration'];
const identity = ['client_id', 'contact_name_id', 'ticket_id', 'user_id'];
const timing = ['start_time', 'end_time', 'duration'];
const instant = (value: unknown) => {
  const date = value instanceof Date ? new Date(value) : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new NativeInteractionCommandError('INTERACTION_INVALID');
  return date;
};
function normalize(input: Record<string, any>, row: any) {
  const patch = Object.fromEntries(writable.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  for (const key of ['client_id', 'contact_name_id', 'ticket_id', 'status_id']) if (patch[key] === '') patch[key] = null;
  for (const key of ['interaction_date', 'start_time', 'end_time']) if (patch[key] != null) patch[key] = instant(patch[key]);
  const next = { ...row, ...patch };
  if (next.interaction_date == null || typeof next.title !== 'string' || !next.title.trim() || next.title.length > 1000 || next.notes != null && (typeof next.notes !== 'string' || next.notes.length > 1_000_000)
    || ![next.type_id, next.user_id].every(isCoManagedUuid) || ['client_id', 'contact_name_id', 'ticket_id', 'status_id'].some(key => next[key] != null && !isCoManagedUuid(next[key]))
    || next.duration != null && (!Number.isInteger(next.duration) || next.duration < 0)
    || next.start_time && next.end_time && !(instant(next.start_time) < instant(next.end_time))) throw new NativeInteractionCommandError('INTERACTION_INVALID');
  return { patch, next };
}
const same = (a: unknown, b: unknown) => a instanceof Date || b instanceof Date ? a != null && b != null && new Date(a as any).getTime() === new Date(b as any).getTime() : a === b;

async function retainParents(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, before: any, after: any) {
  const owner = tenantDb(trx, actor.tenant);
  for (const ticketId of [...new Set([before.ticket_id, after.ticket_id].filter(Boolean))].sort() as string[]) {
    const scope = await retainScheduleSource(trx, actor, subject, { work_item_type: 'ticket', work_item_id: ticketId });
    if (scope.fields.length) throw new CoManagedSharedWorkError();
    for (const row of [before, after]) if (row.ticket_id === ticketId && row.client_id && scope.record.clientId !== row.client_id) throw new NativeInteractionCommandError('INTERACTION_INVALID');
  }
  for (const [table, pk, key, resource] of [['clients', 'client_id', 'client_id', 'client'], ['contacts', 'contact_name_id', 'contact_name_id', 'contact'], ['users', 'user_id', 'user_id', 'user']]) {
    for (const id of [...new Set([before[key], after[key]].filter(Boolean))].sort() as string[]) {
      const parent = await owner.table(table).where(pk, id).forShare().first();
      if (!parent || resource === 'user' && (parent.user_type !== 'internal' || id === after.user_id && id !== before.user_id && parent.is_inactive)) throw new NativeInteractionCommandError('INTERACTION_INVALID');
      const scope = await authorizeCoManagedLocalRecord(trx, actor, subject, resource, 'read', { id, clientId: parent.client_id, ownerUserId: resource === 'user' ? id : undefined });
      if (isCoManagedReadFieldHidden(scope.redactedFields, [pk, `${table}.${pk}`, `values.${pk}`])) throw new CoManagedSharedWorkError();
      if (resource === 'contact') for (const row of [before, after]) if (row.contact_name_id === id && row.client_id !== parent.client_id) throw new NativeInteractionCommandError('INTERACTION_INVALID');
    }
  }
}

/** Actual record, current credential and both sides of a relationship change
 * are retained before mutation. Linked calendar/media/effort keeps its original
 * ownership and timing until an explicit operation handles that linked work. */
export async function updateCoManagedNativeInteraction(db: Knex, tenant: string, id: string, supplied: Record<string, any>,
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: (event: { eventType: 'INTERACTION_UPDATED'; payload: { tenantId: string; interactionId: string; userId: string; changedFields: string[] } }) => Promise<unknown>) {
  const input = structuredClone(supplied);
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    if (!isCoManagedUuid(id) || !input || typeof input !== 'object' || Array.isArray(input)) throw new NativeInteractionCommandError('INTERACTION_INVALID');
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const hint = await owner.table('interactions').where('interaction_id', id).first();
    if (!hint) throw new CoManagedSharedWorkError();
    const proposed = normalize(input, hint);
    await retainParents(trx, actor, credential.subject, hint, proposed.next);
    const row = await owner.table('interactions').where('interaction_id', id).forUpdate().first();
    if (!row || identity.some(key => !same(row[key], hint[key]))) throw new CoManagedSharedWorkError();
    const { patch, next } = normalize(input, row), changed = Object.keys(patch).filter(key => !same(row[key], patch[key]));
    for (const record of [row, next]) for (const action of ['read', 'update']) {
      const decision = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'interaction', action, { id, clientId: record.client_id, ownerUserId: record.user_id });
      if (isCoManagedReadFieldHidden(decision.redactedFields, ['tenant', 'interaction_id', ...changed].flatMap(key => [key, `interactions.${key}`, `values.${key}`]))) throw new CoManagedSharedWorkError();
    }
    if (!await owner.table('interaction_types').where('type_id', next.type_id).forShare().first('type_id') && !await owner.table('system_interaction_types').where('type_id', next.type_id).forShare().first('type_id')) throw new NativeInteractionCommandError('INTERACTION_INVALID');
    if (next.status_id && !await owner.table('statuses').where({ status_id: next.status_id, status_type: 'interaction' }).forShare().first('status_id')) throw new NativeInteractionCommandError('INTERACTION_INVALID');
    if (changed.some(key => identity.includes(key) || timing.includes(key))) {
      const schedules = await owner.table('schedule_entries').where({ work_item_type: 'interaction', work_item_id: id }).orderBy('entry_id').forShare().select('entry_id');
      const meetings = await owner.table('online_meetings').where('interaction_id', id).orderBy('meeting_id').forShare().select('meeting_id');
      const effort = await owner.table('time_entries').where({ work_item_type: 'interaction', work_item_id: id }).forShare().first('entry_id');
      const clock = await owner.table('native_time_tracking_sessions').where({ work_item_type: 'interaction', work_item_id: id }).whereNull('completed_entry_id').forShare().first('session_id');
      if (schedules.length || meetings.length || effort || clock) throw new NativeInteractionCommandError('INTERACTION_IN_USE');
    }
    if (changed.length) await owner.table('interactions').where('interaction_id', id).update(Object.fromEntries(changed.map(key => [key, patch[key]])));
    const projected = await readCoManagedNativeInteractions(trx, tenant, async () => actor, { id });
    if (!projected.handled || projected.interactions.length !== 1) throw new CoManagedSharedWorkError();
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    if (changed.length) registerAfterCommit(trx, async () => { await publish({ eventType: 'INTERACTION_UPDATED', payload: { tenantId: tenant, interactionId: id, userId: actor.userId, changedFields: changed } }); }, 'native-interaction-update');
    return { handled: true as const, interaction: projected.interactions[0] };
  });
}
