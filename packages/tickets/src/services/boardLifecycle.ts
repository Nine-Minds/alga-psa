/**
 * Board lifecycle: create, update and delete as plain functions over a transaction, a tenant and
 * an actor (F103 of `ee/plans/2026-11-21-itil-remediation`).
 *
 * The server actions in `actions/board-actions/boardActions.ts` and the REST `BoardService` both
 * call these, so a board created through the API has the same statuses, categories, default
 * priority and SLA assignment as one created in settings, and a delete refuses for the same
 * reasons on both. The actions add authentication, input parsing and error shaping; nothing about
 * a board's shape is decided in either caller.
 *
 * Rules applied here: R1 (a board's categories and priorities are of the same kind), R3 (a
 * default priority belongs to the board's family) and R7 (which priority a board defaults to).
 */

import { IBoard } from '@alga-psa/types';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  boardFieldKind,
  defaultPriorityForBoardRow,
  listPrioritiesForKind,
  type BoardFieldKind,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import {
  countBoardChecklistApplyRules,
  countCoManagedBoardScopes,
  countLiveCoManagedEscalationsForBoard,
} from '@alga-psa/core/config/deletion';
import {
  BoardTicketStatusInput,
  saveBoardTicketStatusesForBoard,
} from '../actions/board-actions/boardTicketStatusActions';
import {
  CO_MANAGED_ESCALATION_QUEUE_MESSAGE,
  CO_MANAGED_SHARED_BOARD_MESSAGE,
} from '../actions/board-actions/boardActionErrors';
import { parseTicketViewSettings } from '../actions/board-actions/boardViewSettingsSchema';
import type {
  ParsedCreateBoardInput,
  ParsedUpdateBoardInput,
} from '../actions/board-actions/boardInputSchema';
import { ItilStandardsService } from './itilStandardsService';
import { normalizeBoardStopwatchSetting, resolveBoardStopwatchEnabled } from '../lib/boardLiveTicketTimer';

/** Who the write is attributed to. The actions pass the session user; the REST service its caller. */
export interface BoardLifecycleActor {
  userId: string;
}

/**
 * A refusal a caller is expected to show its user (a mixed board, a default priority of the wrong
 * family). `boardActionErrorFrom` turns it into a returned `actionError`, and the REST layer into
 * a 400; anything else thrown here is a fault.
 */
export class BoardLifecycleError extends Error {
  readonly code = 'BOARD_LIFECYCLE_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'BoardLifecycleError';
  }
}

export const MIXED_BOARD_KINDS_MESSAGE =
  'A board uses the standard ITIL categories and priorities together, or its own of both: set category_type and priority_type to the same value.';

export function isBoardLifecycleError(error: unknown): error is BoardLifecycleError {
  return error instanceof Error && (error as { code?: unknown }).code === 'BOARD_LIFECYCLE_REFUSED';
}

/** R3: the board's default priority is a ticket priority of the family the board uses. */
async function assertDefaultPriorityFitsKind(
  trx: Knex | Knex.Transaction,
  tenant: string,
  priorityId: string,
  kind: BoardFieldKind
): Promise<void> {
  const priority = await tenantDb(trx, tenant)
    .table('priorities')
    .where({ priority_id: priorityId })
    .first('priority_name', 'item_type', 'is_from_itil_standard');
  if (!priority) {
    throw new BoardLifecycleError('The selected default priority no longer exists');
  }
  if ((priority.item_type ?? 'ticket') !== 'ticket') {
    throw new BoardLifecycleError(`Priority \u2018${priority.priority_name}\u2019 is not a ticket priority`);
  }
  if (Boolean(priority.is_from_itil_standard) !== (kind === 'itil')) {
    throw new BoardLifecycleError(
      kind === 'itil'
        ? `Priority \u2018${priority.priority_name}\u2019 is not an ITIL priority, so it cannot be the default of a board that uses ITIL priorities`
        : `Priority \u2018${priority.priority_name}\u2019 is an ITIL priority, so it cannot be the default of a board that uses this tenant\u2019s own priorities`
    );
  }
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function stripStatusIdsForNewBoard(
  statuses: BoardTicketStatusInput[]
): BoardTicketStatusInput[] {
  return statuses.map(({ status_id: _ignoredStatusId, ...status }) => status);
}

async function seedBoardTicketStatusesFromStandards(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  userId: string
): Promise<number> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  const existingStatus = await tenantScopedTable('statuses')
    .where({ board_id: boardId, status_type: 'ticket' })
    .first('status_id');

  if (existingStatus) {
    return 0;
  }

  const standardStatuses = await tenantDb(trx, tenant).table('standard_statuses')
    .where({ item_type: 'ticket' })
    .orderBy('display_order', 'asc')
    .orderBy('name', 'asc');

  if (standardStatuses.length === 0) {
    return 0;
  }

  const statusColumns = await tenantDb(trx, tenant).table('statuses').columnInfo();
  const hasStatusColumn = (columnName: string) => Object.prototype.hasOwnProperty.call(statusColumns, columnName);
  const now = new Date().toISOString();

  await tenantScopedTable('statuses').insert(standardStatuses.map((status: any) => ({
    tenant,
    board_id: boardId,
    name: status.name,
    status_type: 'ticket',
    order_number: status.display_order,
    is_closed: normalizeBoolean(status.is_closed),
    is_default: normalizeBoolean(status.is_default),
    created_by: userId,
    ...(hasStatusColumn('item_type') ? { item_type: 'ticket' } : {}),
    ...(hasStatusColumn('standard_status_id') ? { standard_status_id: status.standard_status_id } : {}),
    ...(hasStatusColumn('created_at') ? { created_at: now } : {}),
    ...(hasStatusColumn('updated_at') ? { updated_at: now } : {})
  })));

  return standardStatuses.length;
}

export async function copyBoardTicketStatuses(
  trx: Knex.Transaction,
  tenant: string,
  sourceBoardId: string,
  targetBoardId: string,
  userId: string
): Promise<number> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);
  const statusColumns = await tenantDb(trx, tenant).table('statuses').columnInfo();
  const hasStatusColumn = (columnName: string) => Object.prototype.hasOwnProperty.call(statusColumns, columnName);
  const sourceStatuses = await tenantScopedTable('statuses')
    .where({
      board_id: sourceBoardId,
      status_type: 'ticket'
    })
    .orderBy('order_number', 'asc')
    .orderBy('name', 'asc');

  if (sourceStatuses.length === 0) {
    throw new Error('Select a source board that has ticket statuses to copy');
  }

  const now = new Date().toISOString();
  const clonedStatuses = sourceStatuses.map((status) => ({
    status_id: uuidv4(),
    tenant,
    board_id: targetBoardId,
    name: status.name,
    status_type: status.status_type,
    ...(hasStatusColumn('item_type') ? { item_type: status.item_type || 'ticket' } : {}),
    is_closed: status.is_closed,
    is_default: status.is_default,
    order_number: status.order_number,
    created_by: userId,
    ...(hasStatusColumn('standard_status_id') ? { standard_status_id: status.standard_status_id || null } : {}),
    ...(hasStatusColumn('is_custom') ? { is_custom: status.is_custom } : {}),
    ...(hasStatusColumn('color') ? { color: status.color || null } : {}),
    ...(hasStatusColumn('icon') ? { icon: status.icon || null } : {}),
    ...(hasStatusColumn('portal_selectable') ? { portal_selectable: status.portal_selectable ?? true } : {}),
    ...(hasStatusColumn('created_at') ? { created_at: status.created_at || now } : {}),
    ...(hasStatusColumn('updated_at') ? { updated_at: now } : {}),
  }));

  await tenantScopedTable('statuses').insert(clonedStatuses);
  return clonedStatuses.length;
}

/**
 * Remove all ticket statuses owned by a board, plus their child rows in
 * other tables that hold FK references back to `statuses`.
 *
 * This bypasses the normal "at least one default status per board"
 * enforcement because the entire board is going away.
 *
 * MUST be called inside the same transaction that verified zero tickets
 * reference these statuses — otherwise there is a race where a ticket
 * could be created between the check and the delete.
 */
async function cleanupBoardStatuses(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<void> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  const statusIds = await tenantScopedTable('statuses')
    .where({ board_id: boardId, status_type: 'ticket' })
    .pluck('status_id');

  if (statusIds.length === 0) return;

  // 1. Clear the board's own FK back to statuses (circular ref)
  await tenantScopedTable('boards')
    .where({ board_id: boardId })
    .whereIn('inbound_reply_reopen_status_id', statusIds)
    .update({ inbound_reply_reopen_status_id: null });

  // 2. Remove SLA pause config rows that reference these statuses
  await tenantScopedTable('status_sla_pause_config')
    .whereIn('status_id', statusIds)
    .delete();

  // 2b. Remove the board's notification rules: their status rows reference these
  // statuses with no cascade, so they would block step 3. Recipients and rule
  // statuses cascade from the rule rows; the board is going away with them.
  await tenantScopedTable('board_notification_rules')
    .where({ board_id: boardId })
    .delete();

  // 2c. Remove the board's auto-close rules for the same reason: their
  // trigger_status_id/close_to_status_id point at these statuses with no
  // cascade. The rules only cascade from `boards`, and the board row is still
  // here, so step 3 would hit board_auto_close_rules_trigger_status_fkey.
  // A board-scoped delete is enough — both statuses on a rule are validated to
  // live on that board — and ticket_auto_close_state cascades from the rule.
  await tenantScopedTable('board_auto_close_rules')
    .where({ board_id: boardId })
    .delete();

  // 3. Delete the statuses themselves
  await tenantScopedTable('statuses')
    .where({ board_id: boardId, status_type: 'ticket' })
    .delete();
}

/**
 * Release the board references that neither cascade from `boards` nor get
 * cleared anywhere else, so the board row can actually be deleted.
 *
 * MUST be called inside the transaction that deletes the board.
 *
 * Visibility-group rows are a pure join table and go with the board. Tag
 * definitions do NOT: they are unique per (tenant, tag_text, tagged_type) and
 * shared tenant-wide — `board_id` is only provenance from the channels era
 * (backfilled by 20250930000001) and nothing reads it. Deleting them would
 * cascade away every tag_mapping on every board, so the column is nulled
 * instead, which releases the FK without touching user content.
 */
async function cleanupBoardReferences(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<void> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  await tenantScopedTable('client_portal_visibility_group_boards')
    .where({ board_id: boardId })
    .delete();

  await tenantScopedTable('tag_definitions')
    .where({ board_id: boardId })
    .update({ board_id: null });
}

// English fallbacks for the removal counts. The UI re-renders the same counts
// through t() keys; these keep the server result readable on its own.
const BOARD_REMOVAL_LABELS: Record<string, [singular: string, plural: string]> = {
  categories: ['category', 'categories'],
  statuses: ['ticket status', 'ticket statuses'],
  auto_close_rules: ['auto-close rule', 'auto-close rules'],
  notification_rules: ['notification rule', 'notification rules'],
  portal_visibility_assignments: ['client portal visibility assignment', 'client portal visibility assignments'],
};

function describeBoardRemovals(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([key, count]) => {
    const [singular, plural] = BOARD_REMOVAL_LABELS[key] ?? [key, key];
    return `${count} ${count === 1 ? singular : plural}`;
  });

  if (parts.length <= 1) {
    return parts.join('');
  }

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}


/**
 * F105: insert the board, run the ITIL setup, settle the default priority, then seed statuses —
 * in that order, because the first ITIL board of a tenant has no ITIL priorities to default to
 * until its setup has run.
 */
export async function createBoardCore(
  trx: Knex.Transaction,
  tenant: string,
  actor: BoardLifecycleActor,
  boardData: ParsedCreateBoardInput
): Promise<IBoard> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  // R1/F107: a board's categories and priorities are of the same kind. The settings screen offers
  // one switch for both; a caller that sends them apart is refused rather than producing a mixed
  // board for which no picker can offer a consistent list.
  const categoryKind = boardFieldKind(boardData.category_type);
  const priorityKind = boardFieldKind(boardData.priority_type);
  if (categoryKind !== priorityKind) {
    throw new BoardLifecycleError(MIXED_BOARD_KINDS_MESSAGE);
  }

  // F106: a supplied default priority has to be one this board can offer (R3).
  if (boardData.default_priority_id) {
    await assertDefaultPriorityFitsKind(trx, tenant, boardData.default_priority_id, priorityKind);
  }

  // If no display_order provided, get the next available order
  let displayOrder = boardData.display_order;
  if (displayOrder === undefined || displayOrder === 0) {
    const maxOrder = await tenantScopedTable('boards')
      .max('display_order as max')
      .first();
    displayOrder = (maxOrder?.max || 0) + 1;
  }

  // Check if we should set as default
  let isDefault = boardData.is_default || false;
  if (isDefault) {
    // Check if there's already a default board
    const existingDefault = await tenantScopedTable('boards')
      .where({ is_default: true })
      .first();

    if (existingDefault) {
      // Unset the existing default
      await tenantScopedTable('boards')
        .where({ is_default: true })
        .update({ is_default: false });
    }
  }

  const [newBoard] = (await tenantScopedTable('boards')
    .insert({
      board_name: boardData.board_name,
      description: boardData.description || null,
      display_order: displayOrder,
      is_inactive: boardData.is_inactive || false,
      is_default: isDefault,
      category_type: boardData.category_type || 'custom',
      priority_type: boardData.priority_type || 'custom',
      display_itil_impact: boardData.display_itil_impact || false,
      display_itil_urgency: boardData.display_itil_urgency || false,
      default_assigned_to: boardData.default_assigned_to || null,
      // F109: the settings screen sends a default team, and the insert used to drop it.
      default_assigned_team_id: boardData.default_assigned_team_id || null,
      // The default priority is settled after ITIL setup, below: on a tenant's first ITIL board
      // the ITIL priorities do not exist yet when this row is written.
      default_priority_id: boardData.default_priority_id || null,
      manager_user_id: boardData.manager_user_id || null,
      sla_policy_id: boardData.sla_policy_id || null,
      inbound_reply_reopen_enabled: boardData.inbound_reply_reopen_enabled ?? false,
      inbound_reply_reopen_cutoff_hours: boardData.inbound_reply_reopen_cutoff_hours ?? 168,
      inbound_reply_reopen_status_id: boardData.inbound_reply_reopen_status_id || null,
      inbound_reply_ai_ack_suppression_enabled: boardData.inbound_reply_ai_ack_suppression_enabled ?? false,
      enable_live_ticket_timer: resolveBoardStopwatchEnabled(boardData.enable_live_ticket_timer),
      client_portal_visible: boardData.client_portal_visible ?? true,
      // A new board is pinned by default: it was just created deliberately,
      // so it earns a tab until an admin decides otherwise. list_view_settings
      // starts NULL — a new board inherits the tenant view rather than
      // freezing a copy of it at creation time.
      is_pinned: boardData.is_pinned ?? true,
      tenant
    })
    .returning('*')) as IBoard[];
  const newBoardId = newBoard.board_id;
  if (!newBoardId) {
    throw new Error('Board insert completed without returning a board ID.');
  }

  // If ITIL types are configured, copy the standards to tenant tables
  await ItilStandardsService.handleItilConfiguration(
    trx,
    tenant,
    actor.userId,
    newBoardId,
    boardData.category_type || 'custom',
    boardData.priority_type || 'custom'
  );

  // R7/F105, after ITIL setup so a brand-new ITIL board can take an ITIL default: the board's own
  // default when it fits, otherwise the level-3 ITIL priority or the tenant's lowest-order own
  // priority. A supplied one was checked against the board's family above.
  const defaultPriorityId = await defaultPriorityForBoardRow(trx, tenant, {
    board_id: newBoardId as string,
    board_name: newBoard.board_name ?? '',
    priority_type: newBoard.priority_type,
    default_priority_id: newBoard.default_priority_id ?? null,
  });
  if ((defaultPriorityId ?? null) !== (newBoard.default_priority_id ?? null)) {
    await tenantScopedTable('boards')
      .where({ board_id: newBoardId })
      .update({ default_priority_id: defaultPriorityId });
  }

  if (boardData.ticket_statuses && boardData.ticket_statuses.length > 0) {
    await saveBoardTicketStatusesForBoard(
      trx,
      tenant,
      newBoardId,
      actor.userId,
      stripStatusIdsForNewBoard(boardData.ticket_statuses)
    );
  } else if (boardData.copy_ticket_statuses_from_board_id) {
    await copyBoardTicketStatuses(
      trx,
      tenant,
      boardData.copy_ticket_statuses_from_board_id,
      newBoardId,
      actor.userId
    );
  } else {
    await seedBoardTicketStatusesFromStandards(
      trx,
      tenant,
      newBoardId,
      actor.userId
    );
  }

  // F110: the row as it is after setup — with its default priority, and with the SLA policy the
  // ITIL setup assigned — not the row as it was inserted.
  const createdBoard = ((await tenantScopedTable<IBoard>('boards')
    .where({ board_id: newBoardId })
    .first()) ?? newBoard) as IBoard;

  await publishEvent({
    eventType: 'BOARD_CREATED',
    payload: {
      tenantId: tenant,
      boardId: newBoardId,
      userId: actor.userId,
      changes: { after: createdBoard },
      timestamp: new Date().toISOString(),
    },
  });

  return normalizeBoardStopwatchSetting(createdBoard);
}

/** The board update every caller shares: R1 and R3 first, then the write, the ITIL setup and the statuses. */
export async function updateBoardCore(
  trx: Knex.Transaction,
  tenant: string,
  actor: BoardLifecycleActor,
  boardId: string,
  boardData: ParsedUpdateBoardInput
): Promise<IBoard> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  // Get the current board to check for ITIL type changes
  const currentBoard = await tenantScopedTable<IBoard>('boards')
    .where({ board_id: boardId })
    .first();

  if (!currentBoard) {
    throw new Error('Board not found');
  }

  // Deactivation hides the board from every co-management read just as
  // deletion would; refuse it while a live relationship depends on it.
  if (boardData.is_inactive === true && !currentBoard.is_inactive) {
    if (await countLiveCoManagedEscalationsForBoard(trx, { tenant, entityId: boardId }) > 0) {
      throw new Error(CO_MANAGED_ESCALATION_QUEUE_MESSAGE);
    }
    if (await countCoManagedBoardScopes(trx, { tenant, entityId: boardId }) > 0) {
      throw new Error(CO_MANAGED_SHARED_BOARD_MESSAGE);
    }
  }

  // R1/F108: a change that would leave the board's two kinds different is refused. An existing
  // mixed board keeps saving every other edit (D4): the check fires only on a patch that moves one
  // of the kinds.
  const nextCategoryKind = boardFieldKind(boardData.category_type ?? currentBoard.category_type);
  const nextPriorityKind = boardFieldKind(boardData.priority_type ?? currentBoard.priority_type);
  const touchesKind =
    (boardData.category_type !== undefined
      && boardFieldKind(boardData.category_type) !== boardFieldKind(currentBoard.category_type))
    || (boardData.priority_type !== undefined
      && boardFieldKind(boardData.priority_type) !== boardFieldKind(currentBoard.priority_type));
  if (touchesKind && nextCategoryKind !== nextPriorityKind) {
    throw new BoardLifecycleError(MIXED_BOARD_KINDS_MESSAGE);
  }

  // F106: a supplied default priority has to fit the kind the board will have.
  if (boardData.default_priority_id) {
    await assertDefaultPriorityFitsKind(trx, tenant, boardData.default_priority_id, nextPriorityKind);
  }

  // If setting as default, unset all other defaults first
  if (boardData.is_default === true) {
    await tenantScopedTable('boards')
      .where({ is_default: true })
      .whereNot('board_id', boardId)
      .update({ is_default: false });
  }

  // Sanitize default_assigned_to, manager_user_id, and sla_policy_id: convert empty string to null
  const sanitizedData = { ...boardData };
  if ('default_assigned_to' in sanitizedData) {
    sanitizedData.default_assigned_to = sanitizedData.default_assigned_to || null;
  }
  if ('default_priority_id' in sanitizedData) {
    const v = sanitizedData.default_priority_id as unknown;
    sanitizedData.default_priority_id = (typeof v === 'string' && v.length > 0) ? v : null;
  }
  if ('manager_user_id' in sanitizedData) {
    sanitizedData.manager_user_id = sanitizedData.manager_user_id || null;
  }
  if ('sla_policy_id' in sanitizedData) {
    sanitizedData.sla_policy_id = sanitizedData.sla_policy_id || null;
  }
  if ('inbound_reply_reopen_status_id' in sanitizedData) {
    const v = sanitizedData.inbound_reply_reopen_status_id as unknown;
    sanitizedData.inbound_reply_reopen_status_id = (typeof v === 'string' && v.length > 0) ? v : null;
  }
  if ('inbound_reply_reopen_cutoff_hours' in sanitizedData) {
    const cutoff = Number(sanitizedData.inbound_reply_reopen_cutoff_hours);
    sanitizedData.inbound_reply_reopen_cutoff_hours = Number.isFinite(cutoff) && cutoff > 0
      ? Math.max(1, Math.floor(cutoff))
      : 168;
  }
  if ('inbound_reply_reopen_enabled' in sanitizedData) {
    sanitizedData.inbound_reply_reopen_enabled = Boolean(sanitizedData.inbound_reply_reopen_enabled);
  }
  if ('inbound_reply_ai_ack_suppression_enabled' in sanitizedData) {
    sanitizedData.inbound_reply_ai_ack_suppression_enabled = Boolean(
      sanitizedData.inbound_reply_ai_ack_suppression_enabled
    );
  }
  if ('enable_live_ticket_timer' in sanitizedData) {
    sanitizedData.enable_live_ticket_timer = resolveBoardStopwatchEnabled(sanitizedData.enable_live_ticket_timer);
  }
  if ('client_portal_visible' in sanitizedData) {
    sanitizedData.client_portal_visible = sanitizedData.client_portal_visible ?? true;
  }
  if ('is_pinned' in sanitizedData) {
    sanitizedData.is_pinned = Boolean(sanitizedData.is_pinned);
  }

  const { ticket_statuses: ticketStatuses, list_view_settings: listViewSettings, ...rest } =
    sanitizedData;
  const boardUpdateData: Record<string, unknown> = { ...rest };

  // list_view_settings is validated strictly on write (unknown keys rejected)
  // and stored as JSON text; null is the reset, and is distinct from {}.
  if ('list_view_settings' in sanitizedData) {
    boardUpdateData.list_view_settings =
      listViewSettings === null || listViewSettings === undefined
        ? null
        : JSON.stringify(parseTicketViewSettings(listViewSettings));
  }

  const [updatedBoard] = (await tenantScopedTable('boards')
    .where({ board_id: boardId })
    .update(boardUpdateData)
    .returning('*')) as IBoard[];

  // F120: a kind change is a board type switch, not a field edit. `switchBoardTypeCore` owns what
  // it means — the ITIL rows, the board's default priority, and the fact that no ticket, setting
  // or SLA assignment moves with it (D6) — and the update runs it rather than copying and
  // cleaning up standards on the side.
  const kindChanged =
    (boardData.category_type !== undefined
      && boardFieldKind(boardData.category_type) !== boardFieldKind(currentBoard.category_type))
    || (boardData.priority_type !== undefined
      && boardFieldKind(boardData.priority_type) !== boardFieldKind(currentBoard.priority_type));
  if (kindChanged) {
    await switchBoardTypeCore(trx, tenant, actor, boardId, nextPriorityKind, { publish: false });
  }

  if (ticketStatuses) {
    await saveBoardTicketStatusesForBoard(
      trx,
      tenant,
      boardId,
      actor.userId,
      ticketStatuses
    );
  }

  // A kind change re-settles the board's default priority, so the row the caller gets back is the
  // one in the database, not the one the UPDATE returned.
  const savedBoard = kindChanged
    ? (((await tenantScopedTable<IBoard>('boards').where({ board_id: boardId }).first()) ?? updatedBoard) as IBoard)
    : updatedBoard;

  await publishEvent({
    eventType: 'BOARD_UPDATED',
    payload: {
      tenantId: tenant,
      boardId,
      userId: actor.userId,
      changes: { after: savedBoard },
      timestamp: new Date().toISOString(),
    },
  });

  return normalizeBoardStopwatchSetting(savedBoard);
}

export interface DeleteBoardResult {
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
}

/**
 * Delete a board with the hasDependencies pattern (like deleteClient).
 *
 * - If board is default -> BLOCK
 * - If board is used in inbound_ticket_defaults -> BLOCK
 * - If tickets exist directly on board or in any category/subcategory -> BLOCK
 * - If categories exist and no tickets -> offer to delete them with force=true
 * - If last ITIL board -> offer to cleanup unused ITIL data with cleanupItil=true
 *
 * `db` is the root connection `deleteEntityWithValidation` needs for its own transaction; `trx` is
 * the caller's. Both describe the same tenant.
 */
export async function deleteBoardCore(
  connections: { db: Knex; trx: Knex.Transaction },
  tenant: string,
  actor: BoardLifecycleActor,
  boardId: string,
  options: { force?: boolean; cleanupItil?: boolean } = {}
): Promise<DeleteBoardResult> {
  const { db, trx } = connections;
  const force = options.force ?? false;
  const cleanupItil = options.cleanupItil ?? false;
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  // 1. Get the board
  const board = await tenantScopedTable('boards')
    .where({ board_id: boardId })
    .first();

  if (!board) {
    return { success: false, code: 'NOT_FOUND', message: 'Board not found' };
  }

  // 2. Check if default board (protected)
  if (board.is_default) {
    return {
      success: false,
      code: 'BOARD_IS_DEFAULT',
      message: 'Cannot delete the default board. Please set another board as default first.'
    };
  }

  // Steps 3-3c are configuration blockers and run before the ticket count in
  // step 6 on purpose, matching the existing inbound-defaults placement: they
  // are settings the admin can retarget straight away, whereas moving tickets
  // off a board is a longer job. A board with both reports the settings first.

  // 3. Check if board is used in inbound_ticket_defaults (email routing)
  const inboundDefaultsResult = await tenantScopedTable('inbound_ticket_defaults')
    .where({ board_id: boardId })
    .count('* as count')
    .first();

  const inboundDefaultsCount = Number(inboundDefaultsResult?.count || 0);

  if (inboundDefaultsCount > 0) {
    return {
      success: false,
      code: 'BOARD_USED_IN_EMAIL_ROUTING',
      message: 'Cannot delete board: it is configured as the default board for inbound email tickets. Please update your email routing settings first.',
      dependencies: ['inbound_ticket_defaults'],
      counts: { inbound_ticket_defaults: inboundDefaultsCount }
    };
  }

  // 3b. A board-specific outbound sender route cascades from `boards`, so
  // deleting the board would silently drop the route the client replies to.
  // Block instead and let the admin clear the board's ticket sender first.
  const senderRouteResult = await tenantScopedTable('email_sender_routes')
    .where({ board_id: boardId, route_type: 'board' })
    .count('* as count')
    .first();

  const senderRouteCount = Number(senderRouteResult?.count || 0);

  if (senderRouteCount > 0) {
    return {
      success: false,
      code: 'BOARD_HAS_EMAIL_SENDER_ROUTE',
      message: 'Cannot delete board: it has a dedicated outbound email sender route. Clear the board\'s ticket sender in the board editor first.',
      dependencies: ['email_sender_routes'],
      counts: { email_sender_routes: senderRouteCount }
    };
  }

  // 3c. Settings that point at the board cannot be cleaned up safely:
  // ticket_templates/recurring_ticket_definitions have no FK on board_id at
  // all, so the rows would silently dangle instead of erroring, nulling a
  // checklist apply rule's board predicate changes its meaning, and a
  // board-scoped canned response cannot drop its board_id at all (the
  // scope_target_check requires it) — it would survive as a library entry
  // that silently never applies again. Block, so the admin retargets or
  // removes them deliberately; all four are removable from their own editors.
  //
  // Archived recurring definitions are excluded. They are read-only forever
  // (loadWritableDefinition throws DEFINITION_ARCHIVED and there is no
  // unarchive or hard delete), so blocking on one would strand the board as
  // permanently undeletable — the very failure this card removes. They also
  // never generate tickets (generateRecurringTicketsForTenant filters on
  // is_active + archived_at), so their board_id is inert history. Live rows
  // stay blocking: archiving them is always reachable from the editor, so the
  // block is recoverable.
  const [templateResult, recurringResult, checklistRuleResult, cannedResponseResult] = await Promise.all([
    tenantScopedTable('ticket_templates').where({ board_id: boardId }).count('* as count').first(),
    tenantScopedTable('recurring_ticket_definitions')
      .where({ board_id: boardId })
      .whereNull('archived_at')
      .count('* as count')
      .first(),
    countBoardChecklistApplyRules(trx, { tenant, entityId: boardId }).then((count) => ({ count })),
    // Inactive responses count too: they can be switched back on later, and a
    // reactivated one pointing at a dead board would never match again.
    tenantScopedTable('canned_responses').where({ board_id: boardId }).count('* as count').first(),
  ]);

  const automationCounts: Record<string, number> = {};
  const addAutomationCount = (key: string, raw: unknown) => {
    const count = Number(raw || 0);
    if (count > 0) {
      automationCounts[key] = count;
    }
  };
  addAutomationCount('ticket_templates', templateResult?.count);
  addAutomationCount('recurring_ticket_definitions', recurringResult?.count);
  addAutomationCount('checklist_template_apply_rules', checklistRuleResult?.count);
  addAutomationCount('canned_responses', cannedResponseResult?.count);

  if (Object.keys(automationCounts).length > 0) {
    return {
      success: false,
      code: 'BOARD_REFERENCED_BY_AUTOMATIONS',
      message: 'Cannot delete board: other settings still target it. Point them at another board (or remove them) first.',
      dependencies: Object.keys(automationCounts),
      counts: automationCounts
    };
  }

  // 3d. Co-management depends on this board while its relationship is live: the
  // MSP's escalation queue for a customer workspace, or a customer board the MSP
  // oversees. Deleting it (even with force) would orphan that access. The counters
  // issue no co-managed query for a tenant that does not participate.
  const coManagedEscalations = await countLiveCoManagedEscalationsForBoard(trx, { tenant, entityId: boardId });
  if (coManagedEscalations > 0) {
    return {
      success: false,
      code: 'BOARD_IN_CO_MANAGEMENT',
      message: 'Cannot delete board: it receives escalated tickets from a co-managed IT workspace that is being set up or is active.',
      dependencies: ['co_managed_relationship'],
      counts: { co_managed_relationship: coManagedEscalations }
    };
  }
  const coManagedScopes = await countCoManagedBoardScopes(trx, { tenant, entityId: boardId });
  if (coManagedScopes > 0) {
    return {
      success: false,
      code: 'BOARD_IN_CO_MANAGEMENT',
      message: 'Cannot delete board: it is shared with your MSP under co-managed IT while the relationship is active.',
      dependencies: ['co_managed_relationship'],
      counts: { co_managed_relationship: coManagedScopes }
    };
  }

  // 5. Get the categories this board owns. Every board owns its own, ITIL or not (R2/D9), so
  // there is one rule here as well.
  const allCategories = await tenantScopedTable('categories')
    .where({ board_id: boardId })
    .select('category_id');
  const allCategoryIds = allCategories.map((c: { category_id: string }) => c.category_id);

  // 6. Check for tickets directly on this board. A ticket on ANOTHER board that holds one of
  // these categories already breaks R2; it does not block the delete — the category it holds is
  // kept without a board in step 9 so the ticket keeps its value and stays editable (D3).
  const ticketCountResult = await tenantScopedTable('tickets')
    .where({ board_id: boardId })
    .count('ticket_id as count')
    .first();

  const ticketCount = Number(ticketCountResult?.count || 0);

  if (ticketCount > 0) {
    return {
      success: false,
      code: 'BOARD_HAS_TICKETS',
      message: `Cannot delete board: ${ticketCount} ticket${ticketCount === 1 ? ' is' : 's are'} directly on this board`,
      dependencies: ['tickets'],
      counts: { tickets: ticketCount }
    };
  }

  // 6b. Count board ticket statuses (informational — these are always
  // auto-cleaned because the "at least one default" rule makes manual
  // deletion impossible)
  const statusCountResult = await tenantScopedTable('statuses')
    .where({ board_id: boardId, status_type: 'ticket' })
    .count('status_id as count')
    .first();
  const statusCount = Number(statusCountResult?.count || 0);

  // 6c. Everything else the delete takes down with the board. The user has to
  // see these before confirming — they are not recoverable, and the portal
  // visibility assignments are configuration rather than board plumbing.
  // Tag definitions are deliberately absent: cleanupBoardReferences only
  // clears their provenance board_id, so nothing is removed to confirm.
  const [autoCloseRuleResult, notificationRuleResult, portalVisibilityResult] = await Promise.all([
    tenantScopedTable('board_auto_close_rules').where({ board_id: boardId }).count('* as count').first(),
    tenantScopedTable('board_notification_rules').where({ board_id: boardId }).count('* as count').first(),
    tenantScopedTable('client_portal_visibility_group_boards').where({ board_id: boardId }).count('* as count').first(),
  ]);

  const cascadedCounts: Record<string, number> = {};
  const addCascadedCount = (key: string, raw: unknown) => {
    const count = Number(raw || 0);
    if (count > 0) {
      cascadedCounts[key] = count;
    }
  };
  addCascadedCount('auto_close_rules', autoCloseRuleResult?.count);
  addCascadedCount('notification_rules', notificationRuleResult?.count);
  addCascadedCount('portal_visibility_assignments', portalVisibilityResult?.count);

  // 7. If the board has categories and force=false, prompt for confirmation
  if (allCategoryIds.length > 0 && !force) {
    const counts = {
      categories: allCategoryIds.length,
      ...(statusCount > 0 ? { statuses: statusCount } : {}),
      ...cascadedCounts
    };
    return {
      success: false,
      code: 'BOARD_HAS_CATEGORIES',
      message: `Board has ${describeBoardRemovals(counts)}. Delete them too?`,
      dependencies: Object.keys(counts),
      counts
    };
  }

  // 7b. If the board owns anything else that goes with it and the user hasn't
  // confirmed, list it. The statuses alone are enough to land here, which is
  // why the force path is the one that actually runs the cleanups below.
  if (!force && allCategoryIds.length === 0 && (statusCount > 0 || Object.keys(cascadedCounts).length > 0)) {
    const counts = {
      ...(statusCount > 0 ? { statuses: statusCount } : {}),
      ...cascadedCounts
    };
    return {
      success: false,
      code: 'BOARD_HAS_STATUSES',
      message: `Board has ${describeBoardRemovals(counts)} that will also be removed.`,
      dependencies: Object.keys(counts),
      counts
    };
  }

  // 8. Check if this is the last ITIL board
  const isItilBoard = board.category_type === 'itil' || board.priority_type === 'itil';
  let isLastItilBoard = false;

  if (isItilBoard) {
    const otherItilBoardsResult = await tenantScopedTable('boards')
      .whereNot('board_id', boardId)
      .where(function() {
        this.where('category_type', 'itil').orWhere('priority_type', 'itil');
      })
      .count('* as count')
      .first();

    isLastItilBoard = Number(otherItilBoardsResult?.count || 0) === 0;

    // If last ITIL board and cleanupItil not confirmed, prompt for confirmation
    if (isLastItilBoard && !cleanupItil) {
      return {
        success: false,
        code: 'LAST_ITIL_BOARD',
        message: 'This is the last ITIL board. Do you want to also remove the ITIL priorities no ticket uses?',
        dependencies: ['itil_data']
      };
    }
  }

  // 8b. Retire unused ITIL data while the board row is still present (the
  // cleanup counts ITIL boards, so the one being deleted is excluded). Doing
  // this before the DELETE keeps the FK teardown and the delete in one order
  // that both CE and prod accept.
  let itilCleanupMessage = '';
  if (isLastItilBoard && cleanupItil) {
    const cleanupResult = await ItilStandardsService.cleanupUnusedItilStandards(trx, tenant, [boardId]);

    // Build informative message about what was cleaned up
    const cleanedParts: string[] = [];
    const skippedParts: string[] = [];

    if (cleanupResult.prioritiesDeleted > 0) {
      cleanedParts.push(`${cleanupResult.prioritiesDeleted} ITIL priorit${cleanupResult.prioritiesDeleted === 1 ? 'y' : 'ies'}`);
    }
    if (cleanupResult.prioritiesSkippedReason) {
      skippedParts.push(`priorities (${cleanupResult.prioritiesSkippedReason})`);
    }

    if (cleanedParts.length > 0) {
      itilCleanupMessage = ` Cleaned up: ${cleanedParts.join(', ')}.`;
    }
    if (skippedParts.length > 0) {
      itilCleanupMessage += ` Could not clean up: ${skippedParts.join(', ')}.`;
    }
  }

  // The board's categories go with it (step 9); nothing is re-pointed to another board, because
  // every board owns its own set (D9).
  if (!force && !isLastItilBoard && allCategoryIds.length === 0) {
    const result = await deleteEntityWithValidation('board', boardId, db, tenant, async (boardTrx, tenantId) => {
      // Release the references that have no cascade of their own, then clean
      // up board statuses (can't be deleted manually due to "at least one
      // default status" enforcement, safe because we already confirmed zero
      // tickets above).
      //
      // Reaching here means step 7b did not fire, so there is nothing left for
      // either call to find. They stay as a safety net: the same teardown must
      // happen on whichever path performs the delete, so the two cannot drift.
      await cleanupBoardReferences(boardTrx, tenantId, boardId);
      await cleanupBoardStatuses(boardTrx, tenantId, boardId);

      const deletedCount = await tenantDb(boardTrx, tenantId).table('boards')
        .where({ board_id: boardId })
        .delete();

      if (deletedCount === 0) {
        throw new Error('Board not found');
      }
    });

    if (!result.deleted) {
      return {
        success: false,
        code: result.code,
        message: result.message || 'Failed to delete board',
        dependencies: result.dependencies?.map((dep) => dep.type)
      };
    }

    await publishEvent({
      eventType: 'BOARD_DELETED',
      payload: {
        tenantId: tenant,
        boardId,
        userId: actor.userId,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      message: 'Board deleted.'
    };
  }

  // 9. Delete the board's categories with it. One exception: a category a ticket on another
  // board still holds is kept, without a board, so that ticket keeps its value (D3). Children
  // are deleted before their parents (categories_tenant_parent_category_foreign), and a parent
  // a surviving child still points at is kept too.
  let keptBoardlessCategories = 0;
  if (allCategoryIds.length > 0) {
    const usedRows: Array<{ category_id: string | null; subcategory_id: string | null }> = await tenantScopedTable('tickets')
      .where(function() {
        this.whereIn('category_id', allCategoryIds).orWhereIn('subcategory_id', allCategoryIds);
      })
      .select('category_id', 'subcategory_id');
    const keep = new Set<string>();
    for (const row of usedRows) {
      if (row.category_id && allCategoryIds.includes(row.category_id)) keep.add(row.category_id);
      if (row.subcategory_id && allCategoryIds.includes(row.subcategory_id)) keep.add(row.subcategory_id);
    }

    const rows: Array<{ category_id: string; parent_category: string | null }> = await tenantScopedTable('categories')
      .where({ board_id: boardId })
      .select('category_id', 'parent_category');
    // A kept child keeps its parent alive, so the hierarchy it shows stays readable.
    for (const row of rows) {
      if (!row.parent_category || !keep.has(row.category_id)) continue;
      let parent = rows.find(candidate => candidate.category_id === row.parent_category);
      while (parent) {
        keep.add(parent.category_id);
        parent = parent.parent_category
          ? rows.find(candidate => candidate.category_id === parent!.parent_category)
          : undefined;
      }
    }

    if (keep.size > 0) {
      keptBoardlessCategories = await tenantScopedTable('categories')
        .whereIn('category_id', [...keep])
        .update({ board_id: null });
    }

    const deletable = rows.filter(row => !keep.has(row.category_id));
    const childIds = deletable.filter(row => row.parent_category).map(row => row.category_id);
    if (childIds.length > 0) {
      await tenantScopedTable('categories').whereIn('category_id', childIds).delete();
    }
    const parentIds = deletable.filter(row => !row.parent_category).map(row => row.category_id);
    if (parentIds.length > 0) {
      await tenantScopedTable('categories').whereIn('category_id', parentIds).delete();
    }
  }

  // 10. Release the references that have no cascade of their own, then clean
  // up board statuses (can't be deleted manually due to "at least one default
  // status" enforcement, safe because we already confirmed zero tickets above)
  await cleanupBoardReferences(trx, tenant, boardId);
  await cleanupBoardStatuses(trx, tenant, boardId);

  // 11. Delete the board
  await tenantScopedTable('boards')
    .where({ board_id: boardId })
    .delete();

  await publishEvent({
    eventType: 'BOARD_DELETED',
    payload: {
      tenantId: tenant,
      boardId,
      userId: actor.userId,
      timestamp: new Date().toISOString(),
    },
  });

  return {
    success: true,
    message: allCategoryIds.length > 0
      ? `Board and ${allCategoryIds.length - keptBoardlessCategories} categor${allCategoryIds.length - keptBoardlessCategories === 1 ? 'y' : 'ies'} deleted.${
          keptBoardlessCategories > 0
            ? ` Kept ${keptBoardlessCategories} categor${keptBoardlessCategories === 1 ? 'y' : 'ies'} still used by tickets on other boards.`
            : ''
        }${itilCleanupMessage}`
      : `Board deleted.${itilCleanupMessage}`
  };
}

/** What a board's two kinds will be after a switch. */
export type BoardTypeSwitchKind = BoardFieldKind;

export interface BoardTypeSwitchSla {
  /** `none` — the board has no SLA policy; `no-targets` — its policy has none for the new family. */
  state: 'none' | 'no-targets' | 'ok';
  policyName?: string;
}

export interface BoardTypeSwitchSummary {
  boardId: string;
  boardName: string;
  from: BoardTypeSwitchKind;
  to: BoardTypeSwitchKind;
  /** True when the board's two kinds differ today (D4): the switch also repairs that. */
  mixed: boolean;
  /** Rows on this board whose stored priority will not fit the board after the switch. */
  openTickets: number;
  inboundDefaults: number;
  templates: number;
  schedules: number;
  sla: BoardTypeSwitchSla;
}

export const NO_OWN_PRIORITIES_MESSAGE =
  'This tenant has no ticket priorities of its own, so a board cannot be switched away from the ITIL priorities. Create a priority first.';

/** The family a priority must have for a board of this kind (R3). */
function itilFamilyFor(kind: BoardTypeSwitchKind): boolean {
  return kind === 'itil';
}

async function countRowsWithUnfittingPriority(
  trx: Knex | Knex.Transaction,
  tenant: string,
  table: string,
  boardId: string,
  kind: BoardTypeSwitchKind,
  decorate?: (query: Knex.QueryBuilder) => void
): Promise<number> {
  const scoped = tenantDb(trx, tenant);
  const query = scoped.table(`${table} as subject`).where('subject.board_id', boardId);
  scoped.tenantJoin(query, 'priorities as p', 'p.priority_id', 'subject.priority_id');
  query.where((builder) => {
    if (itilFamilyFor(kind)) {
      builder.where('p.is_from_itil_standard', false).orWhereNull('p.is_from_itil_standard');
    } else {
      builder.where('p.is_from_itil_standard', true);
    }
  });
  decorate?.(query);
  const row = await query.count('* as count').first();
  return Number((row as { count?: string | number } | undefined)?.count ?? 0);
}

/**
 * F117: what an admin is told before confirming. Every count is "rows on this board whose stored
 * priority will not fit the board afterwards" — the switch changes none of them (D3/F116), so the
 * numbers say what will need attention, not what will be rewritten.
 *
 * The SLA line follows D6: a switch assigns no policy, so the board keeps whatever it has, and the
 * summary says whether that policy has any target for the priorities the board will use.
 */
export async function summariseBoardTypeSwitch(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string,
  kind: BoardTypeSwitchKind
): Promise<BoardTypeSwitchSummary> {
  const board = await tenantDb(trx, tenant)
    .table('boards')
    .where({ board_id: boardId })
    .first('board_id', 'board_name', 'category_type', 'priority_type', 'sla_policy_id');
  if (!board) {
    throw new BoardLifecycleError('Board not found');
  }

  const [openTickets, inboundDefaults, templates, schedules] = await Promise.all([
    countRowsWithUnfittingPriority(trx, tenant, 'tickets', boardId, kind, (query) => {
      query.where((builder) => {
        builder.where('subject.is_closed', false).orWhereNull('subject.is_closed');
      });
    }),
    countRowsWithUnfittingPriority(trx, tenant, 'inbound_ticket_defaults', boardId, kind),
    countRowsWithUnfittingPriority(trx, tenant, 'ticket_templates', boardId, kind),
    countRowsWithUnfittingPriority(trx, tenant, 'recurring_ticket_definitions', boardId, kind),
  ]);

  let sla: BoardTypeSwitchSla = { state: 'none' };
  if (board.sla_policy_id) {
    const policy = await tenantDb(trx, tenant)
      .table('sla_policies')
      .where({ sla_policy_id: board.sla_policy_id })
      .first('policy_name');
    const scoped = tenantDb(trx, tenant);
    const targets = scoped.table('sla_policy_targets as t').where('t.sla_policy_id', board.sla_policy_id);
    scoped.tenantJoin(targets, 'priorities as p', 'p.priority_id', 't.priority_id');
    const fitting = await targets
      .where('p.is_from_itil_standard', itilFamilyFor(kind))
      .count('* as count')
      .first();
    sla = {
      state: Number((fitting as { count?: string | number } | undefined)?.count ?? 0) > 0 ? 'ok' : 'no-targets',
      policyName: (policy as { policy_name?: string } | undefined)?.policy_name,
    };
  }

  return {
    boardId,
    boardName: board.board_name,
    from: boardFieldKind(board.priority_type),
    to: kind,
    mixed: boardFieldKind(board.category_type) !== boardFieldKind(board.priority_type),
    openTickets,
    inboundDefaults,
    templates,
    schedules,
    sla,
  };
}

/**
 * F113–F116: set both of a board's kinds to `kind`.
 *
 * Switching to ITIL makes sure the tenant has the ITIL priorities and gives the board its own copy
 * of the standard categories; switching the other way leaves the board's categories exactly where
 * they are — they simply become editable, because the lock reads the board's kind (R2) — and
 * deletes no priority, because priorities are tenant-wide and another board may still use them.
 *
 * Nothing else moves: no ticket, inbound default, template, schedule or SLA assignment is touched
 * (D3/D6). Only the board's default priority is re-settled, because a board must be able to offer
 * one (R7).
 */
export async function switchBoardTypeCore(
  trx: Knex.Transaction,
  tenant: string,
  actor: BoardLifecycleActor,
  boardId: string,
  kind: BoardTypeSwitchKind,
  options: { publish?: boolean } = {}
): Promise<IBoard> {
  const board = await tenantDb(trx, tenant)
    .table<IBoard>('boards')
    .where({ board_id: boardId })
    .first();
  if (!board) {
    throw new BoardLifecycleError('Board not found');
  }

  if (kind === 'custom') {
    // F118: a board must have priorities to offer. The ITIL ones stay (another board may use
    // them), but they are not this board's family any more.
    const own = await listPrioritiesForKind(trx, tenant, 'custom', 'ticket');
    if (own.length === 0) {
      throw new BoardLifecycleError(NO_OWN_PRIORITIES_MESSAGE);
    }
  } else {
    // The tenant's ITIL priorities, then this board's own copy of the standard categories. No SLA
    // policy is created or assigned: that happens only when an ITIL board is created (D1/D6).
    await ItilStandardsService.copyItilPrioritiesToTenant(trx, tenant, actor.userId);
    await ItilStandardsService.copyItilCategoriesToTenant(trx, tenant, actor.userId, boardId);
  }

  await tenantDb(trx, tenant)
    .table('boards')
    .where({ board_id: boardId })
    .update({ category_type: kind, priority_type: kind });

  // R7 on the board's new kind. A stored default of the other family would otherwise be handed to
  // every create on this board.
  const defaultPriorityId = await defaultPriorityForBoardRow(trx, tenant, {
    board_id: boardId,
    board_name: board.board_name ?? '',
    priority_type: kind,
    default_priority_id: board.default_priority_id ?? null,
  });
  if ((defaultPriorityId ?? null) !== (board.default_priority_id ?? null)) {
    await tenantDb(trx, tenant)
      .table('boards')
      .where({ board_id: boardId })
      .update({ default_priority_id: defaultPriorityId });
  }

  const switched = (await tenantDb(trx, tenant)
    .table<IBoard>('boards')
    .where({ board_id: boardId })
    .first()) as IBoard;

  // The board update publishes its own BOARD_UPDATED for the whole patch, so it asks for silence.
  if (options.publish !== false) {
    await publishEvent({
      eventType: 'BOARD_UPDATED',
      payload: {
        tenantId: tenant,
        boardId,
        userId: actor.userId,
        changes: { after: switched },
        timestamp: new Date().toISOString(),
      },
    });
  }

  return normalizeBoardStopwatchSetting(switched);
}
