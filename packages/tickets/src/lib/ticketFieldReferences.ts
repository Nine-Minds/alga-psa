import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { TicketTemplateReferenceProblem } from '@alga-psa/types';
import {
  describePriorityBoardKindMismatch,
  findBoardFieldProblems,
  findTicketPatchBoardFieldProblems,
  resolveTicketPriorityFields,
  type BoardFieldPolicy,
  type BoardFieldProblem,
  type ResolveTicketPriorityInput,
  type ResolvedTicketPriorityFields,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';

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
 * Thrown by an interactive write that refuses a board-owned field (R6): the priority's family, an
 * Impact/Urgency pair with only one side set, a category that is not the board's.
 * `ticketActionErrorFrom` turns it into a returned `actionError(message, messageKey,
 * messageParams)`, so the refusal reaches the user instead of being redacted as an unrecognised
 * server error.
 */
export class TicketBoardFieldError extends Error {
  readonly field: BoardFieldProblem['field'];
  readonly messageKey?: string;
  readonly messageParams?: Record<string, string>;
  constructor(problem: BoardFieldProblem) {
    super(problem.message);
    this.name = 'TicketBoardFieldError';
    this.field = problem.field;
    this.messageKey = problem.messageKey;
    this.messageParams = problem.messageParams;
  }
}

/** The family-mismatch flavour of {@link TicketBoardFieldError}, kept for its narrower type. */
export class PriorityBoardTypeError extends TicketBoardFieldError {
  declare readonly messageKey: string;
  declare readonly messageParams: PriorityBoardTypeProblem['messageParams'];
  constructor(problem: PriorityBoardTypeProblem) {
    super({ field: 'priority_id', ...problem });
    this.name = 'PriorityBoardTypeError';
  }
}

/**
 * R4/R6 for an interactive write: {@link resolveTicketPriorityFields} with `policy: 'refuse'`,
 * turning the first problem into a thrown field error. Create paths pass the submitted values;
 * update paths go through {@link resolveTicketPriorityPatch}.
 */
export async function resolveTicketPriorityFieldsOrThrow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: Omit<ResolveTicketPriorityInput, 'policy'> & { policy?: BoardFieldPolicy }
): Promise<ResolvedTicketPriorityFields> {
  const resolved = await resolveTicketPriorityFields(conn, tenant, { ...input, policy: input.policy ?? 'refuse' });
  const [problem] = resolved.problems;
  if (problem) throw new TicketBoardFieldError(problem);
  return resolved;
}

/** The keys a patch must carry for the priority rule to run again (R5). */
type TicketPriorityPatch = {
  board_id?: string | null;
  priority_id?: string | null;
  itil_impact?: number | null;
  itil_urgency?: number | null;
};

/**
 * R4/R5/R6 for an update: resolves `priority_id`, `itil_impact` and `itil_urgency` in place when the
 * patch touches one of them or moves the ticket to another board, and leaves the patch untouched
 * otherwise — so an unrelated edit still saves on a ticket whose stored pair already breaks R3 (D3).
 *
 * Writes Impact and Urgency only when their effective value differs from the stored one, so a patch
 * that never mentioned them stays minimal unless D5 has to clear them.
 */
export async function resolveTicketPriorityPatch<T extends TicketPriorityPatch>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  current: { board_id?: string | null; priority_id?: string | null; itil_impact?: number | null; itil_urgency?: number | null },
  patch: T,
  policy: BoardFieldPolicy = 'refuse'
): Promise<void> {
  // R5 is about a *change*: a patch that re-sends the stored board, priority or assessment touches
  // nothing, so a legacy ticket whose pair already mismatches keeps saving (the ticket detail form
  // posts every field it holds).
  const same = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);
  const touchesBoard = patch.board_id !== undefined && !same(patch.board_id, current.board_id);
  const touchesPriority = patch.priority_id !== undefined && !same(patch.priority_id, current.priority_id);
  const touchesImpact = 'itil_impact' in patch && !same(patch.itil_impact, current.itil_impact);
  const touchesUrgency = 'itil_urgency' in patch && !same(patch.itil_urgency, current.itil_urgency);
  if (!touchesBoard && !touchesPriority && !touchesImpact && !touchesUrgency) return;

  const resolved = await resolveTicketPriorityFields(conn, tenant, {
    boardId: patch.board_id !== undefined ? patch.board_id : current.board_id,
    ...(patch.priority_id !== undefined ? { priorityId: patch.priority_id } : {}),
    ...('itil_impact' in patch ? { itilImpact: patch.itil_impact } : {}),
    ...('itil_urgency' in patch ? { itilUrgency: patch.itil_urgency } : {}),
    current,
    policy,
  });
  const [problem] = resolved.problems;
  if (problem) throw new TicketBoardFieldError(problem);

  if ((resolved.priority_id ?? null) !== (current.priority_id ?? null) || patch.priority_id !== undefined) {
    patch.priority_id = resolved.priority_id;
  }
  if ((resolved.itil_impact ?? null) !== (current.itil_impact ?? null) || 'itil_impact' in patch) {
    patch.itil_impact = resolved.itil_impact;
  }
  if ((resolved.itil_urgency ?? null) !== (current.itil_urgency ?? null) || 'itil_urgency' in patch) {
    patch.itil_urgency = resolved.itil_urgency;
  }
}

/**
 * A null `priority_type` is `custom` (as in boardActions); a null `is_from_itil_standard` is custom.
 * The rule itself lives in `@alga-psa/shared/lib/tickets/boardFieldRules`; this wrapper keeps the
 * local row types so the template validator below can keep passing the rows it already fetched.
 */
function describePriorityBoardTypeMismatch(
  board: PriorityBoardTypeBoard,
  priority: PriorityBoardTypePriority,
  schedule?: boolean
): PriorityBoardTypeProblem | null {
  return describePriorityBoardKindMismatch(board, priority, schedule);
}

/**
 * Returns a message when the priority's family (ITIL or custom) does not match the board's
 * `priority_type`, otherwise null. Also null when either row does not exist: the existence problems are
 * reported elsewhere. Used by manual ticket create/update; the shared validator applies the same rule on
 * the rows it has already fetched.
 *
 * Delegates to the shared rules module, which is the one implementation of R3.
 */
export async function findPriorityBoardTypeProblem(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string,
  priorityId: string
): Promise<PriorityBoardTypeProblem | null> {
  const problems = await findBoardFieldProblems(conn, tenant, { boardId, priorityId });
  return firstPriorityKindProblem(problems);
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
  const problems = await findTicketPatchBoardFieldProblems(conn, tenant, current, patch);
  return firstPriorityKindProblem(problems);
}

/**
 * These two helpers report the family mismatch only: a missing board, a missing priority or a
 * project-task priority is reported by the callers' own existence checks, and surfacing it here
 * would turn an unrelated data problem into a `PriorityBoardTypeError`.
 */
function firstPriorityKindProblem(
  problems: Array<{ field: string; message: string; messageKey?: string; messageParams?: Record<string, string> }>
): PriorityBoardTypeProblem | null {
  const problem = problems.find(
    (candidate) =>
      candidate.field === 'priority_id' &&
      (candidate.messageKey === 'features/tickets:errors.ticket.priorityItilBoardCustom' ||
        candidate.messageKey === 'features/tickets:errors.ticket.priorityCustomBoardItil')
  );
  if (!problem) return null;
  return {
    message: problem.message,
    messageKey: problem.messageKey!,
    messageParams: problem.messageParams as PriorityBoardTypeProblem['messageParams'],
  };
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

  // R2 is one rule in one place: the category belongs to the board, the subcategory to its parent.
  for (const problem of await findBoardFieldProblems(conn, tenant, {
    boardId: fields.board_id,
    categoryId: fields.category_id,
    subcategoryId: fields.subcategory_id,
  })) {
    if (problem.field !== 'category_id' && problem.field !== 'subcategory_id') continue;
    problems.push({ field: problem.field, message: problem.message });
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
