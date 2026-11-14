import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { TicketTemplateReferenceProblem } from '@alga-psa/types';

/**
 * Reference checks for the ticket field group (board, status, priority, category, assignees, and a
 * client's contact/location/assets). One implementation serves ticket templates (save + apply) and
 * recurring schedules (save + every generated occurrence): there are deliberately no foreign keys to
 * these rows, so a dangling reference is data, reported with an actionable message.
 */

export type TicketFieldReferenceProblem = TicketTemplateReferenceProblem;

export interface TicketFieldReferenceFields {
  board_id: string | null;
  status_id?: string | null;
  priority_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_to?: string | null;
  assigned_team_id?: string | null;
  additional_agent_ids?: readonly string[];
}

export interface TicketFieldReferenceTargets {
  fields: TicketFieldReferenceFields;
  /** Client the ticket is for. Contact, location and assets must belong to it. Omit for a template or a schedule's own defaults. */
  clientId?: string;
  contactId?: string | null;
  locationId?: string | null;
  assetIds?: readonly string[];
  /**
   * The fields are the EFFECTIVE ones of a schedule: a board and priority are mandatory and a status that
   * is not on the board tells the user to edit the schedule. Templates leave both unset (nullable there).
   */
  schedule?: boolean;
}

interface PriorityBoardTypeBoard {
  board_name: string;
  priority_type?: string | null;
}
interface PriorityBoardTypePriority {
  priority_name: string;
  is_from_itil_standard?: boolean | null;
}

export interface PriorityBoardTypeProblem {
  /** The composed English message (names included), shown as-is when no translation applies. */
  message: string;
  messageKey: string;
  messageParams: { priority: string; board: string };
}

/**
 * Thrown by manual ticket create/update. `ticketActionErrorFrom` turns it into a returned
 * `actionError(message, messageKey, messageParams)`, so the refusal reaches the user instead of
 * being redacted as an unrecognised server error.
 */
export class PriorityBoardTypeError extends Error {
  readonly messageKey: string;
  readonly messageParams: PriorityBoardTypeProblem['messageParams'];
  constructor(problem: PriorityBoardTypeProblem) {
    super(problem.message);
    this.name = 'PriorityBoardTypeError';
    this.messageKey = problem.messageKey;
    this.messageParams = problem.messageParams;
  }
}

/** A null `priority_type` is `custom` (as in boardActions); a null `is_from_itil_standard` is custom. */
function describePriorityBoardTypeMismatch(
  board: PriorityBoardTypeBoard,
  priority: PriorityBoardTypePriority,
  schedule?: boolean
): PriorityBoardTypeProblem | null {
  const boardIsItil = (board.priority_type ?? 'custom') === 'itil';
  const priorityIsItil = Boolean(priority.is_from_itil_standard);
  if (boardIsItil === priorityIsItil) return null;
  const suffix = schedule ? '; edit the schedule' : '';
  const message = priorityIsItil
    ? `Priority ‘${priority.priority_name}’ is an ITIL priority but board ‘${board.board_name}’ uses custom priorities${suffix}`
    : `Priority ‘${priority.priority_name}’ is a custom priority but board ‘${board.board_name}’ uses ITIL priorities${suffix}`;
  return {
    message,
    messageKey: priorityIsItil
      ? 'features/tickets:errors.ticket.priorityItilBoardCustom'
      : 'features/tickets:errors.ticket.priorityCustomBoardItil',
    messageParams: { priority: priority.priority_name, board: board.board_name },
  };
}

/**
 * Returns a message when the priority's family (ITIL or custom) does not match the board's
 * `priority_type`, otherwise null. Also null when either row does not exist: the existence problems are
 * reported elsewhere. Used by manual ticket create/update; the shared validator applies the same rule on
 * the rows it has already fetched.
 */
export async function findPriorityBoardTypeProblem(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string,
  priorityId: string
): Promise<PriorityBoardTypeProblem | null> {
  const db = tenantDb(conn, tenant);
  const board = await db.table('boards').where({ board_id: boardId }).first('board_name', 'priority_type');
  if (!board) return null;
  const priority = await db
    .table('priorities')
    .where({ priority_id: priorityId, item_type: 'ticket' })
    .first('priority_name', 'is_from_itil_standard');
  if (!priority) return null;
  return describePriorityBoardTypeMismatch(board, priority);
}

/**
 * The ticket-update flavour of {@link findPriorityBoardTypeProblem}. Decides by key presence: a key that is
 * in the patch (and not `undefined`) replaces the stored value, including an explicit `null`. Only a patch
 * that changes `priority_id` or `board_id` is checked, against the effective pair (a key absent from the
 * patch comes from the existing ticket), so an unrelated update, or one that re-sends the stored values,
 * keeps working on a legacy ticket whose pair already mismatches. A null effective board or priority
 * (e.g. a board move that clears the priority) has nothing to check.
 */
export async function findTicketUpdatePriorityBoardTypeProblem(
  conn: Knex | Knex.Transaction,
  tenant: string,
  current: { board_id?: string | null; priority_id?: string | null },
  patch: { board_id?: string | null; priority_id?: string | null }
): Promise<PriorityBoardTypeProblem | null> {
  const hasBoard = 'board_id' in patch && patch.board_id !== undefined;
  const hasPriority = 'priority_id' in patch && patch.priority_id !== undefined;
  const boardChanged = hasBoard && (patch.board_id ?? null) !== (current.board_id ?? null);
  const priorityChanged = hasPriority && (patch.priority_id ?? null) !== (current.priority_id ?? null);
  if (!boardChanged && !priorityChanged) return null;
  const boardId = hasBoard ? patch.board_id : current.board_id;
  const priorityId = hasPriority ? patch.priority_id : current.priority_id;
  if (!boardId || !priorityId) return null;
  return findPriorityBoardTypeProblem(conn, tenant, boardId, priorityId);
}

/**
 * Checks that everything a ticket will reference still exists and is coherent: the board is active, the
 * status and category belong to that board, assignees are active, and the contact, location and assets
 * belong to the client.
 */
export async function findTicketFieldReferenceProblems(
  conn: Knex | Knex.Transaction,
  tenant: string,
  targets: TicketFieldReferenceTargets
): Promise<TicketFieldReferenceProblem[]> {
  const db = tenantDb(conn, tenant);
  const { fields } = targets;
  const additionalAgentIds = [...(fields.additional_agent_ids ?? [])];
  const problems: TicketFieldReferenceProblem[] = [];

  let board: { board_id: string; board_name: string; is_inactive: boolean; priority_type?: string | null } | undefined;
  if (fields.board_id) {
    board = await db
      .table('boards')
      .where({ board_id: fields.board_id })
      .first('board_id', 'board_name', 'is_inactive', 'priority_type');
    if (!board) {
      problems.push({ field: 'board_id', message: 'The selected board no longer exists' });
    } else if (board.is_inactive) {
      problems.push({ field: 'board_id', message: `Board ‘${board.board_name}’ is inactive` });
    }
  } else if (targets.schedule) {
    problems.push({ field: 'board_id', message: 'A board is required: choose one on the template or override it for this schedule' });
  }

  if (board && fields.status_id) {
    const status = await db
      .table('statuses')
      .where({ status_id: fields.status_id, status_type: 'ticket' })
      .first('status_id', 'board_id', 'name');
    if (!status) {
      problems.push({ field: 'status_id', message: 'The selected status no longer exists' });
    } else if (status.board_id !== fields.board_id) {
      problems.push({
        field: 'status_id',
        message: `Status ‘${status.name}’ does not belong to board ‘${board.board_name}’${targets.schedule ? '; edit the schedule' : ''}`,
      });
    }
  }

  if (fields.priority_id) {
    const priority = await db
      .table('priorities')
      .where({ priority_id: fields.priority_id, item_type: 'ticket' })
      .first('priority_id', 'priority_name', 'is_from_itil_standard');
    if (!priority) {
      problems.push({ field: 'priority_id', message: 'The selected priority no longer exists' });
    } else if (board) {
      const mismatch = describePriorityBoardTypeMismatch(board, priority, targets.schedule);
      if (mismatch) problems.push({ field: 'priority_id', message: mismatch.message });
    }
  } else if (targets.schedule) {
    problems.push({ field: 'priority_id', message: 'A priority is required: choose one on the template or override it for this schedule' });
  }

  if (fields.subcategory_id && !fields.category_id) {
    problems.push({ field: 'subcategory_id', message: 'A subcategory requires a category' });
  }
  if (fields.category_id) {
    const category = await db
      .table('categories')
      .where({ category_id: fields.category_id })
      .first('category_id', 'category_name', 'board_id', 'parent_category');
    if (!category) {
      problems.push({ field: 'category_id', message: 'The selected category no longer exists' });
    } else if (fields.board_id && category.board_id && category.board_id !== fields.board_id) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ does not belong to the selected board` });
    } else if (category.parent_category) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ is a subcategory` });
    }
    if (category && fields.subcategory_id) {
      const sub = await db
        .table('categories')
        .where({ category_id: fields.subcategory_id })
        .first('category_id', 'category_name', 'parent_category');
      if (!sub) {
        problems.push({ field: 'subcategory_id', message: 'The selected subcategory no longer exists' });
      } else if (sub.parent_category !== fields.category_id) {
        problems.push({ field: 'subcategory_id', message: `Subcategory ‘${sub.category_name}’ does not belong to the selected category` });
      }
    }
  }

  const userIds = [...new Set([fields.assigned_to, ...additionalAgentIds].filter((id): id is string => Boolean(id)))];
  if (userIds.length > 0) {
    const users = await db
      .table('users')
      .whereIn('user_id', userIds)
      .select('user_id', 'first_name', 'last_name', 'is_inactive');
    const byId = new Map(users.map((user) => [user.user_id as string, user]));
    const describe = (id: string) => {
      const user = byId.get(id);
      if (!user) return { ok: false, message: 'An assigned user no longer exists' };
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || id;
      return user.is_inactive ? { ok: false, message: `Assigned user ${name} is inactive` } : { ok: true, message: '' };
    };
    if (fields.assigned_to) {
      const result = describe(fields.assigned_to);
      if (!result.ok) problems.push({ field: 'assigned_to', message: result.message });
    }
    for (const id of additionalAgentIds) {
      const result = describe(id);
      if (!result.ok) problems.push({ field: 'additional_agent_ids', message: result.message.replace('Assigned user', 'Additional agent') });
    }
  }

  if (fields.assigned_team_id) {
    const team = await db.table('teams').where({ team_id: fields.assigned_team_id }).first('team_id');
    if (!team) problems.push({ field: 'assigned_team_id', message: 'The assigned team no longer exists' });
  }

  if (targets.clientId) {
    if (targets.contactId) {
      const contact = await db
        .table('contacts')
        .where({ contact_name_id: targets.contactId })
        .first('contact_name_id', 'client_id', 'full_name');
      if (!contact) {
        problems.push({ field: 'contact_id', message: 'The selected contact no longer exists' });
      } else if (contact.client_id !== targets.clientId) {
        problems.push({ field: 'contact_id', message: `Contact ${contact.full_name ?? ''} does not belong to this client`.replace('  ', ' ') });
      }
    }
    if (targets.locationId) {
      const location = await db
        .table('client_locations')
        .where({ location_id: targets.locationId })
        .first('location_id', 'client_id', 'location_name');
      if (!location) {
        problems.push({ field: 'location_id', message: 'The selected location no longer exists' });
      } else if (location.client_id !== targets.clientId) {
        problems.push({ field: 'location_id', message: 'The selected location does not belong to this client' });
      }
    }
    const assetIds = [...new Set(targets.assetIds ?? [])];
    if (assetIds.length > 0) {
      const assets = await db
        .table('assets')
        .whereIn('asset_id', assetIds)
        .where({ client_id: targets.clientId })
        .select('asset_id');
      if (assets.length !== assetIds.length) {
        problems.push({ field: 'asset_ids', message: 'One or more linked assets no longer exist for this client' });
      }
    }
  }

  return problems;
}
