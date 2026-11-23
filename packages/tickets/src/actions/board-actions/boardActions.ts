'use server'

import { IBoard } from '@alga-psa/types';
import Board from '../../models/board';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { BoardTicketStatusInput } from './boardTicketStatusActions';
import {
  copyBoardTicketStatuses as copyBoardTicketStatusesCore,
  createBoardCore,
  deleteBoardCore,
  isBoardLifecycleError,
  summariseBoardTypeSwitch,
  switchBoardTypeCore,
  updateBoardCore,
  type BoardTypeSwitchSummary,
  type DeleteBoardResult,
} from '../../services/boardLifecycle';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { boardActionErrorFrom, type BoardActionError } from './boardActionErrors';
import { parseTicketViewSettings } from './boardViewSettingsSchema';
import { ticketSlaBreachedBindings, ticketSlaBreachedSql } from '../../lib/ticketSlaSql';
import { normalizeBoardStopwatchSetting, resolveBoardStopwatchEnabled } from '../../lib/boardLiveTicketTimer';
import type { TicketViewSettings } from '../../lib/ticketViewSettings';
import { actionError, permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  createBoardInputSchema,
  updateBoardInputSchema,
  type ParsedCreateBoardInput,
  type ParsedUpdateBoardInput,
} from './boardInputSchema';
import {
  BOARD_PERMISSION_DENIED,
  evaluateBoardMutationPolicy,
  type BoardDenialCode,
  type BoardMutationAction,
} from '@alga-psa/auth/boardPolicy';

export interface FindBoardByNameOutput {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  is_inactive: boolean;
}

export interface CreateBoardInput extends Omit<IBoard, 'board_id' | 'tenant'> {
  copy_ticket_statuses_from_board_id?: string | null;
  ticket_statuses?: BoardTicketStatusInput[];
}

export interface UpdateBoardInput extends Partial<Omit<IBoard, 'tenant' | 'board_id'>> {
  ticket_statuses?: BoardTicketStatusInput[];
}

/**
 * Copying a board's ticket statuses is part of the board lifecycle; the implementation moved to
 * `services/boardLifecycle` with board create, and stays exported here for its existing callers.
 */
export async function copyBoardTicketStatuses(
  trx: Knex.Transaction,
  tenant: string,
  sourceBoardId: string,
  targetBoardId: string,
  userId: string
): Promise<number> {
  return copyBoardTicketStatusesCore(trx, tenant, sourceBoardId, targetBoardId, userId);
}

export const findBoardById = withAuth(async (_user, { tenant }, id: string): Promise<IBoard | undefined | BoardActionError> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await Board.get(trx, tenant, id);
      return board ? normalizeBoardStopwatchSetting(board) : board;
    });
  } catch (error) {
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(error);
    throw error;
  }
});

export const getAllBoards = withAuth(async (_user, { tenant }, includeAll: boolean = true): Promise<IBoard[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const boards = await tenantDb(trx, tenant).table<IBoard>('boards')
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc');
      return boards.map((board) => normalizeBoardStopwatchSetting(board));
    });
  } catch (error) {
    console.error('Failed to fetch boards:', error);
    return [];
  }
});

export interface BoardListStats {
  ticketCount: number;
  openTicketCount: number;
  statusCount: number;
  closeRulesEnabled: boolean;
  autoCloseRuleCount: number;
  /** Board header health counts. All three are "open tickets that are also …". */
  overdueTicketCount: number;
  unassignedTicketCount: number;
  slaBreachedTicketCount: number;
  /** Carried here so the tab strip gets pinning and counts in one round trip. */
  isPinned: boolean;
}

/**
 * Per-board aggregate metrics for the boards settings list and the board header
 * (ticket load, health, status count, automation). Tenant-scoped GROUP BYs
 * co-locate on a single Citus shard.
 *
 * The health counts cost no new query: overdue, unassigned and SLA breach are
 * all derivable from columns already on `tickets`, so they are three more
 * COUNT(*) FILTER aggregates on the GROUP BY that already runs. `sla_breached`
 * deliberately reuses the same predicate as `slaStatusFilter: 'breached'` (see
 * ticketSlaSql.ts) so the header count and the filter it invites you to click
 * can never describe different sets.
 *
 * Every board in the tenant gets an entry, including boards with no tickets and
 * no statuses. Previously `ensure()` ran only for boards that appeared in at
 * least one of the four GROUP BYs, so a board with zero tickets but non-zero
 * statuses rendered a `0` pill while a board with zero of both rendered none —
 * two boards in identical states looking different. Seeding from the board list
 * makes "0" mean zero everywhere.
 */
export const getBoardListStats = withAuth(async (_user, { tenant }): Promise<Record<string, BoardListStats>> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const nowIso = new Date().toISOString();
      const breachedSql = ticketSlaBreachedSql('t');
      const breachedBindings = ticketSlaBreachedBindings(nowIso);

      const [boardRows, ticketRows, statusRows, closeRuleRows, autoCloseRows] = await Promise.all([
        tenantDb(trx, tenant).table('boards').select('board_id', 'is_pinned'),
        trx('tickets as t')
          .leftJoin('statuses as s', function () {
            this.on('t.status_id', 's.status_id').andOn('t.tenant', 's.tenant');
          })
          .where('t.tenant', tenant)
          .whereNotNull('t.board_id')
          .groupBy('t.board_id')
          .select('t.board_id')
          .select(trx.raw('COUNT(*)::int as total'))
          .select(trx.raw('COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE)::int as open'))
          .select(trx.raw(
            `COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND t.due_date < ?)::int as overdue`,
            [nowIso]
          ))
          .select(trx.raw(
            'COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND t.assigned_to IS NULL)::int as unassigned'
          ))
          .select(trx.raw(
            `COUNT(*) FILTER (WHERE s.is_closed IS NOT TRUE AND ${breachedSql})::int as sla_breached`,
            breachedBindings
          )),
        trx('statuses')
          .where({ tenant, status_type: 'ticket' })
          .whereNotNull('board_id')
          .groupBy('board_id')
          .select('board_id')
          .select(trx.raw('COUNT(*)::int as count')),
        trx('board_close_rules')
          .where({ tenant })
          .select('board_id', 'is_enabled'),
        trx('board_auto_close_rules')
          .where({ tenant })
          .groupBy('board_id')
          .select('board_id')
          .select(trx.raw('COUNT(*)::int as count')),
      ]);

      const stats: Record<string, BoardListStats> = {};
      const ensure = (boardId: string): BoardListStats => {
        if (!stats[boardId]) {
          stats[boardId] = {
            ticketCount: 0,
            openTicketCount: 0,
            statusCount: 0,
            closeRulesEnabled: false,
            autoCloseRuleCount: 0,
            overdueTicketCount: 0,
            unassignedTicketCount: 0,
            slaBreachedTicketCount: 0,
            isPinned: false,
          };
        }
        return stats[boardId];
      };

      // Seed every board first, so a count of zero is reported as zero rather
      // than as "no entry" (which the UI cannot distinguish from "not loaded").
      for (const row of boardRows as Array<{ board_id: string; is_pinned: boolean | null }>) {
        ensure(row.board_id).isPinned = row.is_pinned === true;
      }

      for (const row of ticketRows as Array<{
        board_id: string;
        total: number;
        open: number;
        overdue: number;
        unassigned: number;
        sla_breached: number;
      }>) {
        const entry = ensure(row.board_id);
        entry.ticketCount = Number(row.total) || 0;
        entry.openTicketCount = Number(row.open) || 0;
        entry.overdueTicketCount = Number(row.overdue) || 0;
        entry.unassignedTicketCount = Number(row.unassigned) || 0;
        entry.slaBreachedTicketCount = Number(row.sla_breached) || 0;
      }
      for (const row of statusRows as Array<{ board_id: string; count: number }>) {
        ensure(row.board_id).statusCount = Number(row.count) || 0;
      }
      for (const row of closeRuleRows as Array<{ board_id: string; is_enabled: boolean }>) {
        ensure(row.board_id).closeRulesEnabled = Boolean(row.is_enabled);
      }
      for (const row of autoCloseRows as Array<{ board_id: string; count: number }>) {
        ensure(row.board_id).autoCloseRuleCount = Number(row.count) || 0;
      }

      return stats;
    });
  } catch (error) {
    console.error('Failed to fetch board list stats:', error);
    return {};
  }
});

type BoardGuardResult<Input> =
  | { ok: true; data: Input }
  | { ok: false; denied: boolean; error: BoardActionError; code?: BoardDenialCode };

/**
 * The single authorization + input gate for board mutations.
 *
 * Order is load-bearing and callers must run it before any read or write
 * (display_order lookup, existing-default lookup, board load):
 *   1. principal: board configuration is MSP-internal; client-portal principals
 *      (user_type 'client', or anything not 'internal') are denied.
 *   2. permission: ticket_settings:<action>, unconditionally — not contingent on
 *      which fields the payload happens to contain.
 *   3. input (create/update): strict schema; unknown keys and wrongly typed
 *      values are rejected, and the result is the explicit writable projection.
 */
/**
 * The permission half of the guard, named for what it is: the board policy takes its checker as a
 * value (`evaluateBoardMutationPolicy(user, action, hasPermission)`), so without a name here the
 * check is invisible to a reader — and to the permission-coverage contract — at every call site.
 */
async function checkBoardMutationPermission(
  user: { user_type?: string } & Record<string, any>,
  action: BoardMutationAction,
  trx?: Knex | Knex.Transaction
) {
  return evaluateBoardMutationPolicy(user, action, hasPermission, trx);
}

// LEVERAGE: pattern board-settings-guard — saveBoardDefaultView/clearBoardDefaultView and the board status/notification/close-rule actions repeat the principal+ticket_settings check inline
async function boardMutationGuard(
  user: { user_type?: string } & Record<string, any>,
  action: 'create',
  input: unknown,
  trx?: Knex | Knex.Transaction
): Promise<BoardGuardResult<ParsedCreateBoardInput>>;
async function boardMutationGuard(
  user: { user_type?: string } & Record<string, any>,
  action: 'update',
  input: unknown,
  trx?: Knex | Knex.Transaction
): Promise<BoardGuardResult<ParsedUpdateBoardInput>>;
async function boardMutationGuard(
  user: { user_type?: string } & Record<string, any>,
  action: 'delete',
  input?: undefined,
  trx?: Knex | Knex.Transaction
): Promise<BoardGuardResult<undefined>>;
async function boardMutationGuard(
  user: { user_type?: string } & Record<string, any>,
  action: BoardMutationAction,
  input?: unknown,
  trx?: Knex | Knex.Transaction
): Promise<BoardGuardResult<any>> {
  const decision = await checkBoardMutationPermission(user, action, trx);
  // Keep explicit discriminant checks: the EE app's tsconfig disables
  // strictNullChecks, where negated booleans do not narrow this union.
  if (decision.allowed === false) {
    const denial = BOARD_PERMISSION_DENIED[action];
    return {
      ok: false,
      denied: true,
      code: decision.code,
      error: permissionError(denial.message, denial.i18nKey),
    };
  }
  if (action === 'delete') {
    return { ok: true, data: undefined };
  }

  const schema = action === 'create' ? createBoardInputSchema : updateBoardInputSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      denied: false,
      error: actionError(`Invalid board input: ${detail}`),
    };
  }
  // Drop explicit-undefined keys so the projection only carries what was sent.
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );
  return { ok: true, data };
}

export const createBoard = withAuth(async (user, { tenant }, rawBoardData: CreateBoardInput): Promise<IBoard | BoardActionError> => {
  const { knex: db } = await createTenantKnex();

  const guard = await boardMutationGuard(user, 'create', rawBoardData, db);
  if (guard.ok === false) {
    return guard.error;
  }
  const boardData = guard.data;

  try {
    // Everything about the board's shape lives in `createBoardCore`, which the REST board API
    // calls too, so the two entry points cannot drift (F103/F104).
    return await withTransaction(db, (trx: Knex.Transaction) =>
      createBoardCore(trx, tenant, { userId: user.user_id }, boardData)
    );
  } catch (error) {
    if (isBoardLifecycleError(error)) {
      return actionError(error.message);
    }
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error creating new board:', error);
    throw error;
  }
});

export const deleteBoard = withAuth(async (
  user,
  { tenant },
  boardId: string,
  force: boolean = false,
  cleanupItil: boolean = false
): Promise<DeleteBoardResult> => {
  const { knex: db } = await createTenantKnex();

  const guard = await boardMutationGuard(user, 'delete', undefined, db);
  if (guard.ok === false) {
    return {
      success: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: Cannot delete boards',
    };
  }

  // Every check and every cleanup lives in `deleteBoardCore`, which the REST delete calls too, so
  // the API cannot remove a board the web refuses to remove (F112).
  return withTransaction(db, (trx: Knex.Transaction) =>
    deleteBoardCore({ db, trx }, tenant, { userId: user.user_id }, boardId, { force, cleanupItil })
  );
});

/**
 * Legacy delete function - throws errors for backward compatibility.
 * Use deleteBoard() with force parameter for new code.
 */
export async function deleteBoardLegacy(boardId: string): Promise<boolean> {
  const result = await deleteBoard(boardId, false);
  if (!result.success) {
    throw new Error(result.message || 'Board deletion returned an unsuccessful result without a message.');
  }
  return true;
}

/**
 * F113/F117: change a board's kind, and the summary an admin sees before confirming it.
 *
 * Both are behind the same guard as any other board mutation (an internal principal with
 * `ticket_settings:update`). The summary reads nothing but counts; the switch itself changes no
 * ticket, setting or SLA assignment (D3/D6) — see `switchBoardTypeCore`.
 */
export const getBoardTypeSwitchSummary = withAuth(async (
  user,
  { tenant },
  boardId: string,
  kind: 'custom' | 'itil'
): Promise<BoardTypeSwitchSummary | BoardActionError> => {
  const { knex: db } = await createTenantKnex();

  const guard = await boardMutationGuard(user, 'update', {}, db);
  if (guard.ok === false) {
    return guard.error;
  }

  try {
    return await withTransaction(db, (trx: Knex.Transaction) =>
      summariseBoardTypeSwitch(trx, tenant, boardId, kind)
    );
  } catch (error) {
    if (isBoardLifecycleError(error)) {
      return actionError(error.message);
    }
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error summarising a board type switch:', error);
    throw error;
  }
});

export const switchBoardType = withAuth(async (
  user,
  { tenant },
  boardId: string,
  kind: 'custom' | 'itil'
): Promise<IBoard | BoardActionError> => {
  const { knex: db } = await createTenantKnex();

  const guard = await boardMutationGuard(user, 'update', {}, db);
  if (guard.ok === false) {
    return guard.error;
  }

  try {
    return await withTransaction(db, (trx: Knex.Transaction) =>
      switchBoardTypeCore(trx, tenant, { userId: user.user_id }, boardId, kind)
    );
  } catch (error) {
    if (isBoardLifecycleError(error)) {
      return actionError(error.message);
    }
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error switching a board type:', error);
    throw error;
  }
});

export const updateBoard = withAuth(async (user, { tenant }, boardId: string, rawBoardData: UpdateBoardInput): Promise<IBoard | BoardActionError> => {
  const { knex: db } = await createTenantKnex();

  // Unconditional, and before the board load / default-unset / any write.
  const guard = await boardMutationGuard(user, 'update', rawBoardData, db);
  if (guard.ok === false) {
    return guard.error;
  }
  const boardData = guard.data;

  try {
    return await withTransaction(db, (trx: Knex.Transaction) =>
      updateBoardCore(trx, tenant, { userId: user.user_id }, boardId, boardData)
    );
  } catch (error) {
    if (isBoardLifecycleError(error)) {
      return actionError(error.message);
    }
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating board:', error);
    throw error;
  }
});

export interface BoardIdentity {
  boardId: string;
  managerUserId: string | null;
  managerName: string | null;
  slaPolicyId: string | null;
  slaPolicyName: string | null;
}

/**
 * The ownership half of the board header — manager and SLA policy display names
 * for every board, in one round trip.
 *
 * Resolved for all boards rather than for the active one so switching tabs costs
 * no fetch, and loaded out of band exactly as the tab pills are: the header
 * renders its identity immediately and grows the ownership line when this
 * arrives. A board with no manager or no SLA policy yields nulls, which the
 * header omits rather than rendering an empty slot.
 */
export const getBoardIdentities = withAuth(async (_user, { tenant }): Promise<BoardIdentity[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = await tenantDb(trx, tenant).table('boards as b')
        .leftJoin('users as u', function () {
          this.on('b.manager_user_id', 'u.user_id').andOn('b.tenant', 'u.tenant');
        })
        .leftJoin('sla_policies as p', function () {
          this.on('b.sla_policy_id', 'p.sla_policy_id').andOn('b.tenant', 'p.tenant');
        })
        .select(
          'b.board_id',
          'b.manager_user_id',
          'u.first_name',
          'u.last_name',
          'b.sla_policy_id',
          'p.policy_name'
        );

      return (rows as Array<Record<string, any>>).map((row) => {
        const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
        return {
          boardId: row.board_id as string,
          managerUserId: (row.manager_user_id as string | null) ?? null,
          managerName: name.length > 0 ? name : null,
          slaPolicyId: (row.sla_policy_id as string | null) ?? null,
          slaPolicyName: (row.policy_name as string | null) ?? null,
        };
      });
    });
  } catch (error) {
    // Ownership is decoration on the header; failing it must not fail the list.
    console.error('Failed to fetch board identities:', error);
    return [];
  }
});

/**
 * Save the board's default ticket-list view, captured from the live list.
 *
 * Authoring is capture-from-the-list rather than a second filter UI in
 * settings: the admin arranges the real list and saves it, which is why every
 * filter added to ITicketListFilters in future is defaultable for free.
 *
 * Gated on ticket_settings:update — the permission that already guards board and
 * priority settings — because this is tenant-wide configuration for all users,
 * not a personal preference.
 */
export const saveBoardDefaultView = withAuth(async (
  user,
  { tenant },
  boardId: string,
  view: TicketViewSettings,
): Promise<{ success: true } | BoardActionError | ActionPermissionError> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermission(user, 'ticket_settings', 'update', db)) {
    return permissionError('Permission denied: Cannot update ticket settings', 'features/tickets:errors.settings.updateDenied');
  }

  try {
    // Strict parse: unknown keys are rejected here rather than silently stored,
    // so a stale client cannot deposit a key nothing will read.
    const parsed = parseTicketViewSettings(view);

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const updated = await tenantDb(trx, tenant).table('boards')
        .where({ board_id: boardId })
        .update({ list_view_settings: JSON.stringify(parsed) });

      if (!updated) {
        throw new Error('Board not found');
      }
      return { success: true as const };
    });
  } catch (error) {
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error saving board default view:', error);
    throw error;
  }
});

/**
 * Reset the board to the tenant default view.
 *
 * Writes NULL, not {}. An empty object would be a board that has decided to
 * express nothing — indistinguishable in storage from a board that has decided
 * nothing, but a different thing to reason about, and one that would have to be
 * special-cased in the resolver forever. NULL falls through cleanly.
 */
export const clearBoardDefaultView = withAuth(async (
  user,
  { tenant },
  boardId: string,
): Promise<{ success: true } | BoardActionError | ActionPermissionError> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermission(user, 'ticket_settings', 'update', db)) {
    return permissionError('Permission denied: Cannot update ticket settings', 'features/tickets:errors.settings.updateDenied');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const updated = await tenantDb(trx, tenant).table('boards')
        .where({ board_id: boardId })
        .update({ list_view_settings: null });

      if (!updated) {
        throw new Error('Board not found');
      }
      return { success: true as const };
    });
  } catch (error) {
    const expected = boardActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error clearing board default view:', error);
    throw error;
  }
});

/**
 * Find board by name
 * This action searches for existing boards by name
 */
export const findBoardByName = withAuth(async (_user, { tenant }, name: string): Promise<FindBoardByNameOutput | null> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const board = await tenantDb(trx, tenant).table('boards')
      .select('board_id as id', 'board_name as name', 'description', 'is_default', 'is_inactive')
      .whereRaw('LOWER(board_name) = LOWER(?)', [name])
      .first() as FindBoardByNameOutput | undefined;

    return board ?? null;
  });
});
