import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isLicensedUserType } from '@alga-psa/types';
import { HumanWorkAssigneeInvalidError, HumanWorkOwnerRequiredError } from './HumanWorkOwnerRequiredError';

export { HumanWorkAssigneeInvalidError, HumanWorkOwnerRequiredError };

type MaybeId = string | null | undefined;
type Db = Knex | Knex.Transaction;

/**
 * Where a write will leave a ticket. A field that is `undefined` is not being changed and the
 * stored value is used; `null` means the write clears it.
 */
export interface PendingTicketPlacement {
  clientId?: string | null;
  boardId?: string | null;
}

/**
 * The work item an assignment is being made to. The guard resolves own-client and scope from it
 * for seat technicians (internal users holding a seat assignment for one client); for everyone
 * else it is not read.
 *
 * - `ticket`: an existing ticket (with `pending` when the same write moves it: the client and
 *   board it will have afterwards are judged, not the ones it has now). Needs the client and a board with `work` or `create` access.
 * - `ticket_draft`: a ticket being created. Needs the client and a board with `create` access.
 * - `project_task`: an existing task. Needs the client and a project shared with the technician.
 * - `project` / `project_phase`: a task being created in a project, or in one of its phases (same rule
 *   as `project_task`).
 * - `unscoped`: no own-client/scope can be established (interactions, appointment requests,
 *   schedule entries, time on non-ticket work...). A seat technician is always refused.
 */
export type HumanWorkItem =
  | { kind: 'ticket'; ticketId: string; pending?: PendingTicketPlacement }
  | { kind: 'ticket_draft'; clientId: string | null | undefined; boardId: string | null | undefined }
  | { kind: 'project_task'; taskId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'project_phase'; phaseId: string }
  | { kind: 'unscoped'; surface: string };

/**
 * The work item a time entry is logged against. Ticket, project and project-task time resolve like
 * the work itself; every other kind (interaction, ad hoc, non-billable) has no client scope to
 * establish and is `unscoped`.
 */
export function timeEntryWorkItem(
  workItemType: string | null | undefined,
  workItemId: string | null | undefined
): HumanWorkItem {
  if (workItemId) {
    if (workItemType === 'ticket') return { kind: 'ticket', ticketId: workItemId };
    if (workItemType === 'project_task') return { kind: 'project_task', taskId: workItemId };
    if (workItemType === 'project') return { kind: 'project', projectId: workItemId };
  }
  return { kind: 'unscoped', surface: 'time_entry' };
}

interface SeatRow {
  userId: string;
  arrangementId: string | null;
  clientId: string | null;
}

async function loadUsers(trx: Db, tenant: string, ids: string[]) {
  const scoped = tenantDb(trx, tenant);
  // One query: user validity plus any seat assignment row (any state: a seat technician whose seat
  // is not live stays in the class and is granted nothing, as in the seat authority resolver).
  const query = scoped.table('users as u');
  scoped.tenantJoin(query, 'co_managed_seat_assignments as a', 'a.user_id', 'u.user_id', { type: 'left', rootTenantColumn: 'u.tenant' });
  query.leftJoin('co_managed_seat_arrangements as r', function joinArrangement() {
    this.on('r.tenant', '=', 'a.tenant').andOn('r.arrangement_id', '=', 'a.arrangement_id');
  });
  const rows = (await query
    .whereIn('u.user_id', ids)
    .select(
      'u.user_id',
      'u.user_type',
      'u.is_inactive',
      'a.assignment_id',
      'a.state as assignment_state',
      'a.arrangement_id',
      'r.state as arrangement_state',
      'r.client_id'
    )) as Array<{
    user_id: string;
    user_type: string | null;
    is_inactive: boolean | null;
    assignment_id: string | null;
    assignment_state: string | null;
    arrangement_id: string | null;
    arrangement_state: string | null;
    client_id: string | null;
  }>;
  const valid = new Set<string>();
  const seats = new Map<string, SeatRow>();
  for (const row of rows) {
    if (!row.is_inactive && isLicensedUserType(row.user_type)) valid.add(row.user_id);
    if (!row.assignment_id) continue;
    const live = row.assignment_state === 'active' && row.arrangement_state === 'active';
    const prior = seats.get(row.user_id);
    // A live assignment wins over history; a user with none live carries no scope.
    if (!prior || (live && !prior.arrangementId)) {
      seats.set(row.user_id, { userId: row.user_id, arrangementId: live ? row.arrangement_id : null, clientId: live ? row.client_id : null });
    }
  }
  return { valid, seats };
}

interface ResolvedWorkItem {
  clientId: string | null;
  boardId: string | null;
  projectId: string | null;
  needsCreate: boolean;
}

async function resolveWorkItem(trx: Db, tenant: string, item: HumanWorkItem): Promise<ResolvedWorkItem | null> {
  const db = tenantDb(trx, tenant);
  switch (item.kind) {
    case 'ticket': {
      const row = await db.table('tickets').where('ticket_id', item.ticketId).first('client_id', 'board_id');
      if (!row) return null;
      return {
        clientId: (item.pending?.clientId !== undefined ? item.pending.clientId : row.client_id) ?? null,
        boardId: (item.pending?.boardId !== undefined ? item.pending.boardId : row.board_id) ?? null,
        projectId: null,
        needsCreate: false,
      };
    }
    case 'ticket_draft':
      return { clientId: item.clientId ?? null, boardId: item.boardId ?? null, projectId: null, needsCreate: true };
    case 'project_task': {
      const query = db.table('project_tasks as t');
      db.tenantJoin(query, 'project_phases as ph', 'ph.phase_id', 't.phase_id', { rootTenantColumn: 't.tenant' });
      db.tenantJoin(query, 'projects as p', 'p.project_id', 'ph.project_id', { rootTenantColumn: 'ph.tenant' });
      const row = await query.where('t.task_id', item.taskId).first('p.project_id', 'p.client_id');
      return row ? { clientId: row.client_id ?? null, boardId: null, projectId: row.project_id, needsCreate: false } : null;
    }
    case 'project': {
      const row = await db.table('projects').where('project_id', item.projectId).first('project_id', 'client_id');
      return row ? { clientId: row.client_id ?? null, boardId: null, projectId: row.project_id, needsCreate: false } : null;
    }
    case 'project_phase': {
      const query = db.table('project_phases as ph');
      db.tenantJoin(query, 'projects as p', 'p.project_id', 'ph.project_id', { rootTenantColumn: 'ph.tenant' });
      const row = await query.where('ph.phase_id', item.phaseId).first('p.project_id', 'p.client_id');
      return row ? { clientId: row.client_id ?? null, boardId: null, projectId: row.project_id, needsCreate: false } : null;
    }
    case 'unscoped':
      return null;
  }
}

/** Whether a seat technician's arrangement covers the work item: own client and in scope. */
async function seatCovers(trx: Db, tenant: string, seat: SeatRow, item: HumanWorkItem): Promise<boolean> {
  if (!seat.arrangementId || !seat.clientId) return false;
  const resolved = await resolveWorkItem(trx, tenant, item);
  if (!resolved || resolved.clientId !== seat.clientId) return false;
  const db = tenantDb(trx, tenant);
  if (item.kind === 'ticket' || item.kind === 'ticket_draft') {
    if (!resolved.boardId) return false;
    const entry = await db.table('co_managed_seat_board_scopes')
      .where({ arrangement_id: seat.arrangementId, board_id: resolved.boardId }).first('can_create');
    // Mirrors coManagedSeatBoardAccess: not listed = none; listed = work; flagged = create.
    return !!entry && (!resolved.needsCreate || entry.can_create === true);
  }
  if (item.kind === 'project_task' || item.kind === 'project' || item.kind === 'project_phase') {
    if (!resolved.projectId) return false;
    const grant = await db.table('co_managed_seat_project_grants')
      .where({ arrangement_id: seat.arrangementId, project_id: resolved.projectId }).first('project_id');
    return !!grant;
  }
  return false;
}

async function loadInvalidIds(trx: Db, tenant: string, ids: string[]): Promise<string[]> {
  const { valid } = await loadUsers(trx, tenant, ids);
  return ids.filter((id) => !valid.has(id));
}

/**
 * Human-work guard: every id must be an active, licensed (`internal`) user of the tenant, and a
 * seat technician may only be assigned work of their own client that is in their scope (see
 * `HumanWorkItem`). Missing, inactive, client and service ids are rejected. null/undefined ids are
 * ignored. Call only with ids the write sets or changes so legacy references never block
 * unrelated edits.
 *
 * `workItem` may be a list when one write assigns across several items; a seat technician must be
 * covered by every one.
 *
 * Cost: one query. Work-item resolution runs only when an id is a seat technician.
 */
export async function assertHumanWorkAssignee(
  trx: Db,
  tenant: string,
  userIds: ReadonlyArray<MaybeId>,
  workItem: HumanWorkItem | readonly HumanWorkItem[]
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return;
  const { valid, seats } = await loadUsers(trx, tenant, ids);
  const invalid = ids.filter((id) => !valid.has(id));
  if (invalid.length > 0) {
    throw new HumanWorkAssigneeInvalidError(invalid);
  }
  await refuseSeatsOutsideScope(trx, tenant, seats, workItem);
}

async function refuseSeatsOutsideScope(
  trx: Db,
  tenant: string,
  seats: Map<string, SeatRow>,
  workItem: HumanWorkItem | readonly HumanWorkItem[]
): Promise<void> {
  if (seats.size === 0) return;
  // A write that touches several work items (a bundle's children) needs the seat to cover each.
  const items: readonly HumanWorkItem[] = Array.isArray(workItem) ? workItem : [workItem as HumanWorkItem];
  const refused: string[] = [];
  for (const seat of seats.values()) {
    for (const item of items) {
      if (!(await seatCovers(trx, tenant, seat, item))) {
        refused.push(seat.userId);
        break;
      }
    }
  }
  if (refused.length > 0) throw new HumanWorkAssigneeInvalidError(refused, 'seat_out_of_scope');
}

/**
 * A write that moves a ticket (new client and/or board) must not strand a seat technician on work
 * that is no longer theirs: the primary assignee the ticket will have (`primaryAssignee`: the new
 * one when the write reassigns; `undefined` reads the current one) and every additional agent are checked
 * against the post-write placement. Only seat scope is judged, never validity, so a legacy
 * reference never blocks a move. Cost: one `ticket_resources` read and one users query.
 */
export async function assertTicketMoveKeepsSeatsInScope(
  trx: Db,
  tenant: string,
  ticketId: string,
  pending: PendingTicketPlacement,
  primaryAssignee: MaybeId
): Promise<void> {
  if (pending.clientId === undefined && pending.boardId === undefined) return;
  if (primaryAssignee === undefined) {
    const current = await tenantDb(trx, tenant).table('tickets').where('ticket_id', ticketId).first('assigned_to');
    primaryAssignee = current?.assigned_to ?? null;
  }
  const resources = (await tenantDb(trx, tenant).table('ticket_resources')
    .where('ticket_id', ticketId)
    .select('additional_user_id')) as Array<{ additional_user_id: string | null }>;
  const ids = Array.from(new Set([primaryAssignee, ...resources.map((row) => row.additional_user_id)]
    .filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return;
  const { seats } = await loadUsers(trx, tenant, ids);
  await refuseSeatsOutsideScope(trx, tenant, seats, { kind: 'ticket', ticketId, pending });
}

/**
 * Guard for writes that DEFAULT ownership to the caller: the effective user must be an
 * active internal user, else HumanWorkOwnerRequiredError(field).
 */
export async function assertHumanWorkOwner(
  trx: Knex | Knex.Transaction,
  tenant: string,
  effectiveUserId: MaybeId,
  field: string
): Promise<void> {
  if (!effectiveUserId) throw new HumanWorkOwnerRequiredError(field);
  const invalid = await loadInvalidIds(trx, tenant, [effectiveUserId]);
  if (invalid.length > 0) throw new HumanWorkOwnerRequiredError(field);
}
