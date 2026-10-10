import type { Knex } from 'knex';
import { computeWorkDateFields, resolveUserTimeZone, tenantDb } from '@alga-psa/db';
import type { IUser } from '@alga-psa/types';
import { persistTimeEntry, type PersistedTimeEntry } from '../timeEntryWriteCore';
import { resolveTimeSheetForWorkDate } from '../timeSheetResolution';
import { saveTimeEntryParamsSchema, type SaveTimeEntryParams } from '../../actions/timeEntrySchemas';
import { StopwatchConflictError, StopwatchError } from './stopwatchErrors';
import { activeMs, toEntrySpan } from './stopwatchMath';
import type {
  LogSessionInput,
  StartSessionInput,
  StartSessionOptions,
  StopwatchOptions,
  StopwatchSegmentView,
  StopwatchSessionView,
  UpdateSessionDraftInput,
} from './stopwatchTypes';

/**
 * Server-side stopwatch core (plan section 5). Transaction level: every function takes a
 * caller-owned `trx`, the tenant, and the acting user; the caller commits. All functions act
 * on the ACTING USER's own session (user_id = actorUserId); permission checks (RBAC,
 * delegation) are the caller's job.
 *
 * Elapsed time is always derived from segments (stopwatchMath), never stored.
 */

export * from './stopwatchTypes';
export { StopwatchConflictError, StopwatchError } from './stopwatchErrors';

const OPEN_STATUSES = ['running', 'paused'];
const OPEN_SESSION_CONSTRAINT = 'time_tracking_sessions_one_open_per_user_uq';

/** Citus appends `_<shardid>` to constraint/index names raised from shard execution. */
function baseConstraintName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/_\d+$/, '') : '';
}

async function currentTime(trx: Knex.Transaction, options?: StopwatchOptions): Promise<Date> {
  if (options?.now) return options.now;
  const result = await trx.raw('SELECT clock_timestamp() AS now');
  const value = result.rows[0].now;
  return value instanceof Date ? value : new Date(value);
}

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

async function loadSegments(trx: Knex.Transaction, tenant: string, sessionId: string): Promise<StopwatchSegmentView[]> {
  const rows = await tenantDb(trx, tenant).table('time_tracking_session_segments')
    .where({ session_id: sessionId })
    .orderBy('started_at', 'asc')
    .select('segment_id', 'started_at', 'ended_at');
  return rows.map((row: any) => ({
    segment_id: row.segment_id,
    started_at: iso(row.started_at) as string,
    ended_at: iso(row.ended_at),
  }));
}

async function loadDisplayFields(trx: Knex.Transaction, tenant: string, session: any) {
  const db = tenantDb(trx, tenant);
  const out = {
    ticket_number: null as string | null,
    work_item_title: null as string | null,
    project_name: null as string | null,
    client_name: null as string | null,
    service_name: null as string | null,
  };

  if (session.work_item_type === 'ticket' && session.work_item_id) {
    const query = db.table('tickets').where({ 'tickets.ticket_id': session.work_item_id });
    db.tenantJoin(query, 'clients', 'tickets.client_id', 'clients.client_id', { type: 'left' });
    const row = await query.first('tickets.ticket_number', 'tickets.title', 'clients.client_name');
    if (row) {
      out.ticket_number = row.ticket_number ?? null;
      out.work_item_title = row.title ?? null;
      out.client_name = row.client_name ?? null;
    }
  } else if (session.work_item_type === 'project_task' && session.work_item_id) {
    const query = db.table('project_tasks').where({ 'project_tasks.task_id': session.work_item_id });
    db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    db.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
    db.tenantJoin(query, 'clients', 'projects.client_id', 'clients.client_id', { type: 'left' });
    const row = await query.first('project_tasks.task_name', 'projects.project_name', 'clients.client_name');
    if (row) {
      out.work_item_title = row.task_name ?? null;
      out.project_name = row.project_name ?? null;
      out.client_name = row.client_name ?? null;
    }
  }

  if (session.service_id) {
    const service = await db.table('service_catalog')
      .where({ service_id: session.service_id })
      .first('service_name');
    out.service_name = service?.service_name ?? null;
  }
  return out;
}

async function buildView(
  trx: Knex.Transaction,
  tenant: string,
  session: any,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView> {
  const now = await currentTime(trx, options);
  const segments = await loadSegments(trx, tenant, session.session_id);
  const display = await loadDisplayFields(trx, tenant, session);
  return {
    session_id: session.session_id,
    user_id: session.user_id,
    work_item_type: session.work_item_type,
    work_item_id: session.work_item_id ?? null,
    service_id: session.service_id ?? null,
    notes: session.notes ?? '',
    status: session.status,
    time_entry_id: session.time_entry_id ?? null,
    closed_at: iso(session.closed_at),
    created_at: iso(session.created_at) as string,
    updated_at: iso(session.updated_at) as string,
    segments,
    active_ms: activeMs(segments, now),
    server_now: now.toISOString(),
    ...display,
  };
}

/** Lock the actor's own session row. Throws notFound when it does not exist or is someone else's. */
async function lockOwnSession(trx: Knex.Transaction, tenant: string, actorUserId: string, sessionId: string): Promise<any> {
  const session = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId, user_id: actorUserId })
    .forUpdate()
    .first();
  if (!session) throw new StopwatchError('notFound');
  return session;
}

/** Close the open segment (if any) at `now`, never earlier than its own start. */
async function closeOpenSegment(trx: Knex.Transaction, tenant: string, sessionId: string, now: Date): Promise<void> {
  const open = await tenantDb(trx, tenant).table('time_tracking_session_segments')
    .where({ session_id: sessionId })
    .whereNull('ended_at')
    .first('segment_id', 'started_at');
  if (!open) return;
  const startedAt = new Date(open.started_at);
  const endedAt = now.getTime() < startedAt.getTime() ? startedAt : now;
  await tenantDb(trx, tenant).table('time_tracking_session_segments')
    .where({ segment_id: open.segment_id })
    .whereNull('ended_at')
    .update({ ended_at: endedAt });
}

export async function getOpenSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView | null> {
  const session = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ user_id: actorUserId })
    .whereIn('status', OPEN_STATUSES)
    .first();
  return session ? buildView(trx, tenant, session, options) : null;
}

/** Any session (open or closed) by id belonging to the actor, or null. */
export async function getSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  sessionId: string,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView | null> {
  const session = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId, user_id: actorUserId })
    .first();
  return session ? buildView(trx, tenant, session, options) : null;
}

async function assertWorkItemStartable(
  trx: Knex.Transaction,
  tenant: string,
  input: StartSessionInput,
  options?: StartSessionOptions,
): Promise<void> {
  const db = tenantDb(trx, tenant);

  if (input.workItemType === 'ticket') {
    if (!input.workItemId) throw new StopwatchError('workItemNotFound');
    const query = db.table('tickets').where({ 'tickets.ticket_id': input.workItemId });
    db.tenantJoin(query, 'boards', 'tickets.board_id', 'boards.board_id', { type: 'left' });
    const ticket = await query.first('tickets.ticket_id', 'boards.enable_live_ticket_timer');
    if (!ticket) throw new StopwatchError('workItemNotFound');
    // D12: the board flag now means "show the stopwatch on tickets in this board". Missing = enabled
    // (same rule as resolveBoardStopwatchEnabled in @alga-psa/tickets, which scheduling cannot import).
    if (ticket.enable_live_ticket_timer === false) throw new StopwatchError('boardDisabled');
    return;
  }

  if (input.workItemType === 'project_task') {
    if (!input.workItemId) throw new StopwatchError('workItemNotFound');
    const task = await db.table('project_tasks').where({ task_id: input.workItemId }).first('task_id');
    if (!task) throw new StopwatchError('workItemNotFound');
    return;
  }

  if (!options?.allowLegacyWorkItemTypes) throw new StopwatchError('unsupportedWorkItem');
}

export async function startSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  input: StartSessionInput,
  options?: StartSessionOptions,
): Promise<StopwatchSessionView> {
  await assertWorkItemStartable(trx, tenant, input, options);

  const existing = await getOpenSession(trx, tenant, actorUserId, options);
  if (existing) throw new StopwatchConflictError(existing);

  const now = await currentTime(trx, options);
  const db = tenantDb(trx, tenant);

  let sessionRow: any;
  try {
    // Savepoint: a unique violation from a concurrent start must not abort the caller's transaction,
    // because we still need to read the winner's session to build the conflict.
    sessionRow = await trx.transaction(async (savepoint) => {
      const [created] = await tenantDb(savepoint, tenant).table('time_tracking_sessions')
        .insert({
          tenant,
          user_id: actorUserId,
          work_item_type: input.workItemType,
          work_item_id: input.workItemId ?? null,
          service_id: input.serviceId ?? null,
          notes: input.notes ?? '',
          status: 'running',
          created_at: now,
          updated_at: now,
        })
        .returning('*');
      return created;
    });
  } catch (error: any) {
    if (error?.code === '23505' && baseConstraintName(error.constraint) === OPEN_SESSION_CONSTRAINT) {
      const winner = await getOpenSession(trx, tenant, actorUserId, options);
      if (winner) throw new StopwatchConflictError(winner);
    }
    throw error;
  }

  await db.table('time_tracking_session_segments').insert({
    tenant,
    session_id: sessionRow.session_id,
    started_at: now,
    ended_at: null,
  });

  return buildView(trx, tenant, sessionRow, options);
}

export async function pauseSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  sessionId: string,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView> {
  const session = await lockOwnSession(trx, tenant, actorUserId, sessionId);
  if (session.status === 'paused') return buildView(trx, tenant, session, options);
  if (session.status !== 'running') throw new StopwatchError('notOpen');

  const now = await currentTime(trx, options);
  await closeOpenSegment(trx, tenant, sessionId, now);
  const [updated] = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId })
    .update({ status: 'paused', updated_at: now })
    .returning('*');
  return buildView(trx, tenant, updated, options);
}

export async function resumeSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  sessionId: string,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView> {
  const session = await lockOwnSession(trx, tenant, actorUserId, sessionId);
  if (session.status === 'running') return buildView(trx, tenant, session, options);
  if (session.status !== 'paused') throw new StopwatchError('notOpen');

  const now = await currentTime(trx, options);
  await tenantDb(trx, tenant).table('time_tracking_session_segments').insert({
    tenant,
    session_id: sessionId,
    started_at: now,
    ended_at: null,
  });
  const [updated] = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId })
    .update({ status: 'running', updated_at: now })
    .returning('*');
  return buildView(trx, tenant, updated, options);
}

export async function discardSession(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  sessionId: string,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView> {
  const session = await lockOwnSession(trx, tenant, actorUserId, sessionId);
  if (session.status === 'discarded') return buildView(trx, tenant, session, options);
  if (!OPEN_STATUSES.includes(session.status)) throw new StopwatchError('notOpen');

  const now = await currentTime(trx, options);
  await closeOpenSegment(trx, tenant, sessionId, now);
  const [updated] = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId })
    .update({ status: 'discarded', closed_at: now, updated_at: now })
    .returning('*');
  return buildView(trx, tenant, updated, options);
}

export async function updateSessionDraft(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  sessionId: string,
  input: UpdateSessionDraftInput,
  options?: StopwatchOptions,
): Promise<StopwatchSessionView> {
  const session = await lockOwnSession(trx, tenant, actorUserId, sessionId);
  if (!OPEN_STATUSES.includes(session.status)) throw new StopwatchError('notOpen');

  const patch: Record<string, unknown> = {};
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.serviceId !== undefined) patch.service_id = input.serviceId;
  if (Object.keys(patch).length === 0) return buildView(trx, tenant, session, options);

  patch.updated_at = await currentTime(trx, options);
  const [updated] = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId })
    .update(patch)
    .returning('*');
  return buildView(trx, tenant, updated, options);
}

export interface LogSessionResult {
  session: StopwatchSessionView;
  persisted: PersistedTimeEntry;
}

/**
 * Log an open session as exactly one time entry (D4/D5), inside the caller's transaction:
 * pauses it if running, builds the entry from toEntrySpan with caller overrides, resolves the
 * sheet (unless the caller names one), persists through persistTimeEntry, then marks the
 * session logged. Throws an expected error (locked sheet, no period, ...) when it cannot; the
 * caller's transaction then rolls back, so a session that was paused beforehand stays paused
 * (a running one stays running).
 *
 * Callers publish events AFTER commit: publishPersistedTimeEntryEvents(result.persisted).
 * `actor` is the acting user and must own the session. Permission checks are the caller's job.
 */
export async function logSession(
  trx: Knex.Transaction,
  tenant: string,
  actor: IUser,
  sessionId: string,
  input: LogSessionInput = {},
  options?: StopwatchOptions,
): Promise<LogSessionResult> {
  const session = await lockOwnSession(trx, tenant, actor.user_id, sessionId);
  if (!OPEN_STATUSES.includes(session.status)) throw new StopwatchError('notOpen');

  const now = await currentTime(trx, options);
  if (session.status === 'running') {
    await closeOpenSegment(trx, tenant, sessionId, now);
  }
  const segments = await loadSegments(trx, tenant, sessionId);
  const span = toEntrySpan(segments, now);

  const startIso = input.start_time ?? span.start.toISOString();
  const endIso = input.end_time ?? span.end.toISOString();
  const spanMinutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  const billable =
    input.is_billable === false ? 0 : (input.billable_duration ?? Math.max(0, spanMinutes));

  const entryUserId = input.user_id ?? actor.user_id;
  let timeSheetId = input.time_sheet_id;
  if (!timeSheetId) {
    const timeZone = await resolveUserTimeZone(trx, tenant, entryUserId);
    const { work_date } = computeWorkDateFields(startIso, timeZone);
    timeSheetId = (await resolveTimeSheetForWorkDate(trx, tenant, entryUserId, work_date)).timeSheetId;
  }

  const serviceId = input.service_id ?? session.service_id ?? undefined;
  if (!serviceId?.trim()) {
    throw new Error('Service is required for time entries');
  }

  const nowIso = now.toISOString();
  const entry = saveTimeEntryParamsSchema.parse({
    entry_id: null,
    work_item_id: input.work_item_id ?? session.work_item_id,
    work_item_type: input.work_item_type ?? session.work_item_type,
    start_time: startIso,
    end_time: endIso,
    created_at: nowIso,
    updated_at: nowIso,
    billable_duration: billable,
    notes: input.notes ?? session.notes ?? '',
    user_id: entryUserId,
    time_sheet_id: timeSheetId,
    approval_status: 'DRAFT',
    service_id: serviceId,
    contract_line_id: input.contract_line_id ?? undefined,
    tax_region: input.tax_region,
    tax_rate_id: input.tax_rate_id ?? undefined,
  }) as SaveTimeEntryParams;

  const persisted = await persistTimeEntry(trx, { tenant, actor, entry });

  const [updated] = await tenantDb(trx, tenant).table('time_tracking_sessions')
    .where({ session_id: sessionId })
    .update({
      status: 'logged',
      time_entry_id: persisted.entry.entry_id,
      closed_at: now,
      updated_at: now,
      service_id: serviceId,
      notes: entry.notes,
    })
    .returning('*');

  return { session: await buildView(trx, tenant, updated, options), persisted };
}
