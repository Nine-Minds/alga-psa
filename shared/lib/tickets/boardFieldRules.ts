import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { calculateItilPriority } from '../itil/priorityMatrix';

/**
 * One set of rules for the board-owned ticket fields: which priorities and categories a board
 * offers, whether a given one is valid for it, the ITIL priority for an Impact × Urgency pair,
 * and the board's default priority.
 *
 * Plain functions over a knex connection or transaction and a tenant, so server actions, REST
 * services, `shared/workflow`, co-managed and the integrations package can all call them. It
 * lives in `shared/` because `reference-data` must not import `tickets`, and co-managed
 * deliberately does not either.
 *
 * Rules (PRD `ee/plans/2026-11-21-itil-remediation`):
 * - R1 a board's categories and priorities are of the same kind;
 * - R2 a category belongs to a board, a subcategory to its parent;
 * - R3 a priority's family (`is_from_itil_standard`) matches the board's `priority_type`;
 * - R4 Impact × Urgency decides the priority on an ITIL board;
 * - R5 a check looks only at what a change touches;
 * - R6 interactive paths refuse, automated paths fall back;
 * - R7 the board's default priority.
 */

export type BoardFieldKind = 'custom' | 'itil';

/** A null `priority_type`/`category_type` is `custom`, as in `boardActions`. */
export function boardFieldKind(value: string | null | undefined): BoardFieldKind {
  return value === 'itil' ? 'itil' : 'custom';
}

export interface BoardFieldBoard {
  board_id: string;
  board_name: string;
  category_type?: string | null;
  priority_type?: string | null;
  default_priority_id?: string | null;
}

export interface BoardFieldPriority {
  priority_id: string;
  priority_name: string;
  order_number?: number | null;
  color?: string | null;
  item_type?: string | null;
  is_from_itil_standard?: boolean | null;
  itil_priority_level?: number | null;
}

export interface BoardFieldCategory {
  category_id: string;
  category_name: string;
  board_id?: string | null;
  parent_category?: string | null;
  is_from_itil_standard?: boolean | null;
  /** The `standard_categories.id` this row was copied from; null for a tenant's own category. */
  standard_category_id?: string | null;
}

export type BoardFieldName = 'board_id' | 'priority_id' | 'category_id' | 'subcategory_id' | 'itil_impact' | 'itil_urgency';

export interface BoardFieldProblem {
  field: BoardFieldName;
  /** The composed English message (names included), shown as-is when no translation applies. */
  message: string;
  messageKey?: string;
  messageParams?: Record<string, string>;
}

const BOARD_COLUMNS = ['board_id', 'board_name', 'category_type', 'priority_type', 'default_priority_id'] as const;
const PRIORITY_COLUMNS = [
  'priority_id',
  'priority_name',
  'order_number',
  'color',
  'item_type',
  'is_from_itil_standard',
  'itil_priority_level',
] as const;
const CATEGORY_COLUMNS = [
  'category_id',
  'category_name',
  'board_id',
  'parent_category',
  'is_from_itil_standard',
  'standard_category_id',
] as const;

export async function loadBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<BoardFieldBoard | null> {
  const board = await tenantDb(conn, tenant).table('boards').where({ board_id: boardId }).first(...BOARD_COLUMNS);
  return (board as BoardFieldBoard | undefined) ?? null;
}

async function loadPriority(
  conn: Knex | Knex.Transaction,
  tenant: string,
  priorityId: string
): Promise<BoardFieldPriority | null> {
  const priority = await tenantDb(conn, tenant)
    .table('priorities')
    .where({ priority_id: priorityId })
    .first(...PRIORITY_COLUMNS);
  return (priority as BoardFieldPriority | undefined) ?? null;
}

async function loadCategory(
  conn: Knex | Knex.Transaction,
  tenant: string,
  categoryId: string
): Promise<BoardFieldCategory | null> {
  const category = await tenantDb(conn, tenant)
    .table('categories')
    .where({ category_id: categoryId })
    .first(...CATEGORY_COLUMNS);
  return (category as BoardFieldCategory | undefined) ?? null;
}

export interface PriorityBoardKindMismatch {
  message: string;
  messageKey: string;
  messageParams: { priority: string; board: string };
}

/**
 * R3 as a pure function on rows already fetched. Returns null when the families match or either
 * row is missing (existence is reported separately).
 */
export function describePriorityBoardKindMismatch(
  board: Pick<BoardFieldBoard, 'board_name' | 'priority_type'>,
  priority: Pick<BoardFieldPriority, 'priority_name' | 'is_from_itil_standard'>,
  schedule?: boolean
): PriorityBoardKindMismatch | null {
  const boardIsItil = boardFieldKind(board.priority_type) === 'itil';
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
 * The ticket priorities a board offers (R3): the ITIL family on an ITIL board, the tenant's own
 * everywhere else. ITIL rows come back in level order, the tenant's own in `order_number` order.
 * An unknown board offers nothing.
 */
export async function listPrioritiesForBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string,
  itemType: 'ticket' | 'project_task' = 'ticket'
): Promise<BoardFieldPriority[]> {
  const board = await loadBoard(conn, tenant, boardId);
  if (!board) return [];
  return listPrioritiesForKind(conn, tenant, boardFieldKind(board.priority_type), itemType);
}

/** {@link listPrioritiesForBoard} for a kind already known (a board being created, a kind switch). */
export async function listPrioritiesForKind(
  conn: Knex | Knex.Transaction,
  tenant: string,
  kind: BoardFieldKind,
  itemType: 'ticket' | 'project_task' = 'ticket'
): Promise<BoardFieldPriority[]> {
  // The whole row: this is the list every picker renders, and the components read colour, order
  // and the ITIL level off it.
  const query = tenantDb(conn, tenant)
    .table('priorities')
    .where({ item_type: itemType })
    .select('*');

  if (kind === 'itil') {
    const rows = (await query
      .where({ is_from_itil_standard: true })
      .orderBy('itil_priority_level', 'asc')
      .orderBy('order_number', 'asc')) as BoardFieldPriority[];
    return rows;
  }

  const rows = (await query
    .where((builder) => {
      builder.where({ is_from_itil_standard: false }).orWhereNull('is_from_itil_standard');
    })
    .orderBy('order_number', 'asc')) as BoardFieldPriority[];
  return rows;
}

/**
 * R2. The categories a board offers: the rows owned by that board, whatever its kind. An ITIL
 * board owns its own copy of the standard set (D9), so there is one rule for both kinds and no
 * flag is consulted. Categories with no board belong to no board and are offered by nobody.
 *
 * Parents come before their own children, each group in `display_order` then name order, which is
 * the order every category picker renders.
 */
export async function listCategoriesForBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<BoardFieldCategory[]> {
  const rows = (await tenantDb(conn, tenant)
    .table('categories')
    .where({ board_id: boardId })
    .select('*')
    .orderBy('display_order', 'asc')
    .orderBy('category_name', 'asc')) as BoardFieldCategory[];
  return orderCategoriesHierarchically(rows);
}

/** Parents first, each followed by its own children; anything orphaned keeps its place at the end. */
export function orderCategoriesHierarchically<T extends { category_id: string; parent_category?: string | null }>(
  categories: T[]
): T[] {
  const parents = categories.filter((category) => !category.parent_category);
  const childrenByParent = new Map<string, T[]>();
  for (const category of categories) {
    if (!category.parent_category) continue;
    const siblings = childrenByParent.get(category.parent_category);
    if (siblings) siblings.push(category);
    else childrenByParent.set(category.parent_category, [category]);
  }

  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const parent of parents) {
    ordered.push(parent);
    placed.add(parent.category_id);
    for (const child of childrenByParent.get(parent.category_id) ?? []) {
      ordered.push(child);
      placed.add(child.category_id);
    }
  }
  for (const category of categories) {
    if (!placed.has(category.category_id)) ordered.push(category);
  }
  return ordered;
}

/**
 * R2. The target board's own copy of the same standard category.
 *
 * Integrations, workflows and API callers hold one board's category id; after D9 every ITIL board
 * has its own copy of each standard row, so a write naming another board's copy is translated
 * rather than refused. Returns null for a category that is already on the target board, for a
 * category with no standard link, and for a target board that owns no copy of that standard row.
 * A subcategory is translated to the matching child of the target board's copy of its parent.
 */
export async function translateStandardCategoryForBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  categoryId: string,
  boardId: string
): Promise<string | null> {
  if (!categoryId || !boardId) return null;
  const category = await loadCategory(conn, tenant, categoryId);
  if (!category) return null;
  if (category.board_id === boardId) return null;
  if (!category.standard_category_id) return null;

  const copy = await tenantDb(conn, tenant)
    .table('categories')
    .where({ board_id: boardId, standard_category_id: category.standard_category_id })
    .first('category_id');
  return (copy as { category_id: string } | undefined)?.category_id ?? null;
}

/**
 * R2 for a write: the category (and subcategory) the ticket's own board owns for the same standard
 * row. A value that is already the board's, has no standard link, or has no copy on the board is
 * returned unchanged, so the caller can hand the pair straight to the check.
 */
export async function translateStandardCategoryPairForBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string | null | undefined,
  categoryId: string | null | undefined,
  subcategoryId?: string | null
): Promise<{ categoryId: string | null; subcategoryId: string | null }> {
  const translate = async (id: string | null | undefined): Promise<string | null> => {
    if (!id || !boardId) return id ?? null;
    return (await translateStandardCategoryForBoard(conn, tenant, id, boardId)) ?? id;
  };
  return {
    categoryId: await translate(categoryId),
    subcategoryId: await translate(subcategoryId),
  };
}

export interface BoardFieldCandidate {
  boardId: string | null | undefined;
  priorityId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Message suffix for schedules, matching the ticket template/schedule wording. */
  schedule?: boolean;
}

/**
 * Checks a board/priority/category triple. Every problem is field-level and names the value and
 * the board, so a refusing caller can show it against the field the user picked.
 */
export async function findBoardFieldProblems(
  conn: Knex | Knex.Transaction,
  tenant: string,
  candidate: BoardFieldCandidate
): Promise<BoardFieldProblem[]> {
  const problems: BoardFieldProblem[] = [];
  const boardId = candidate.boardId ?? null;
  const board = boardId ? await loadBoard(conn, tenant, boardId) : null;

  if (candidate.priorityId) {
    const priority = await loadPriority(conn, tenant, candidate.priorityId);
    if (!priority) {
      problems.push({
        field: 'priority_id',
        message: 'The selected priority no longer exists',
      });
    } else if (priority.item_type && priority.item_type !== 'ticket') {
      problems.push({
        field: 'priority_id',
        message: `Priority ‘${priority.priority_name}’ is not a ticket priority`,
        messageParams: { priority: priority.priority_name },
      });
    } else if (board) {
      const mismatch = describePriorityBoardKindMismatch(board, priority, candidate.schedule);
      if (mismatch) problems.push({ field: 'priority_id', ...mismatch });
    }
  }

  if (candidate.subcategoryId && !candidate.categoryId) {
    problems.push({
      field: 'subcategory_id',
      message: 'A subcategory requires a category',
    });
  }

  if (candidate.categoryId) {
    const category = await loadCategory(conn, tenant, candidate.categoryId);
    if (!category) {
      problems.push({
        field: 'category_id',
        message: 'The selected category no longer exists',
      });
    } else {
      const boardProblem = describeCategoryBoardProblem(category, board, boardId);
      if (boardProblem) problems.push(boardProblem);
      else if (category.parent_category) {
        problems.push({
          field: 'category_id',
          message: `Category ‘${category.category_name}’ is a subcategory`,
          messageParams: { category: category.category_name },
        });
      }
    }

    if (category && candidate.subcategoryId) {
      const sub = await loadCategory(conn, tenant, candidate.subcategoryId);
      if (!sub) {
        problems.push({
          field: 'subcategory_id',
          message: 'The selected subcategory no longer exists',
        });
      } else if ((sub.parent_category ?? null) !== candidate.categoryId) {
        problems.push({
          field: 'subcategory_id',
          message: `Subcategory ‘${sub.category_name}’ does not belong to the selected category`,
          messageParams: { subcategory: sub.category_name },
        });
      }
    }
  }

  return problems;
}

/**
 * R2: a category is valid for a board when it is owned by that board — the same rule for ITIL and
 * for the tenant's own categories, because every ITIL board owns its copy of the standard set (D9).
 * A category with no board belongs to no board, so it is not a valid selection anywhere; a ticket
 * that already holds one keeps it, because R5 only checks what a change touches.
 */
function describeCategoryBoardProblem(
  category: BoardFieldCategory,
  board: BoardFieldBoard | null,
  boardId: string | null
): BoardFieldProblem | null {
  if (!boardId) return null;
  if (category.board_id === boardId) return null;
  if (!category.board_id) {
    return {
      field: 'category_id',
      message: `Category ‘${category.category_name}’ belongs to no board`,
      messageParams: { category: category.category_name },
    };
  }
  return {
    field: 'category_id',
    message: `Category ‘${category.category_name}’ does not belong to ${board ? `board ‘${board.board_name}’` : 'the selected board'}`,
    messageParams: { category: category.category_name, board: board?.board_name ?? '' },
  };
}

export interface TicketBoardFieldState {
  board_id?: string | null;
  priority_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
}

/** Whether a key is present in the patch with a value (an explicit `null` counts, `undefined` does not). */
function supplied<T extends object, K extends keyof T>(patch: T, key: K): boolean {
  return key in patch && patch[key] !== undefined;
}

function changed<K extends keyof TicketBoardFieldState>(
  current: TicketBoardFieldState,
  patch: TicketBoardFieldState,
  key: K
): boolean {
  return supplied(patch, key) && (patch[key] ?? null) !== (current[key] ?? null);
}

/**
 * R5. The priority is checked only when the patch changes `priority_id` or `board_id`, and the
 * category only when it changes `category_id`, `subcategory_id` or `board_id`, each against the
 * effective value (a key absent from the patch comes from the stored ticket). So a ticket that
 * already breaks R2 or R3 still saves a change to any other field (D3).
 */
export async function findTicketPatchBoardFieldProblems(
  conn: Knex | Knex.Transaction,
  tenant: string,
  current: TicketBoardFieldState,
  patch: TicketBoardFieldState
): Promise<BoardFieldProblem[]> {
  const boardChanged = changed(current, patch, 'board_id');
  const priorityChanged = changed(current, patch, 'priority_id');
  const categoryChanged = changed(current, patch, 'category_id') || changed(current, patch, 'subcategory_id');

  const checkPriority = boardChanged || priorityChanged;
  const checkCategory = boardChanged || categoryChanged;
  if (!checkPriority && !checkCategory) return [];

  const effective = <K extends keyof TicketBoardFieldState>(key: K): TicketBoardFieldState[K] =>
    supplied(patch, key) ? patch[key] : current[key];

  const boardId = effective('board_id') ?? null;
  const problems = await findBoardFieldProblems(conn, tenant, {
    boardId,
    priorityId: checkPriority ? effective('priority_id') ?? null : null,
    categoryId: checkCategory ? effective('category_id') ?? null : null,
    subcategoryId: checkCategory ? effective('subcategory_id') ?? null : null,
  });

  return problems;
}

/**
 * The tenant's ITIL priority for an Impact × Urgency pair, found by `itil_priority_level` (D8), so
 * a renamed priority is still found. Null when the tenant has no ITIL priority for that level or
 * either value is outside 1–5.
 */
export async function resolveItilPriorityId(
  conn: Knex | Knex.Transaction,
  tenant: string,
  impact: number,
  urgency: number
): Promise<string | null> {
  let level: number;
  try {
    level = calculateItilPriority(impact, urgency);
  } catch {
    return null;
  }
  return resolveItilPriorityIdForLevel(conn, tenant, level);
}

/**
 * D8. The ITIL level of a ticket is the level of its priority, never a stored ticket column:
 * `tickets.itil_priority_level` is no longer written, so readers ask the priority row.
 */
export async function itilPriorityLevelForPriority(
  conn: Knex | Knex.Transaction,
  tenant: string,
  priorityId: string | null | undefined
): Promise<number | null> {
  if (!priorityId) return null;
  const priority = await loadPriority(conn, tenant, priorityId);
  if (!priority || !priority.is_from_itil_standard) return null;
  return normaliseLevel(priority.itil_priority_level);
}

/** {@link resolveItilPriorityId} for a level already computed. */
export async function resolveItilPriorityIdForLevel(
  conn: Knex | Knex.Transaction,
  tenant: string,
  level: number
): Promise<string | null> {
  const row = await tenantDb(conn, tenant)
    .table('priorities')
    .where({ is_from_itil_standard: true, item_type: 'ticket', itil_priority_level: level })
    .orderBy('order_number', 'asc')
    .first('priority_id');
  return (row as { priority_id: string } | undefined)?.priority_id ?? null;
}

/**
 * R7. `boards.default_priority_id` when it fits the board, otherwise the level-3 ITIL priority on
 * an ITIL board or the lowest-order own ticket priority elsewhere, otherwise null.
 */
export async function defaultPriorityForBoard(
  conn: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<string | null> {
  const board = await loadBoard(conn, tenant, boardId);
  if (!board) return null;
  return defaultPriorityForBoardRow(conn, tenant, board);
}

/** {@link defaultPriorityForBoard} for a board row already fetched. */
export async function defaultPriorityForBoardRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  board: BoardFieldBoard
): Promise<string | null> {
  const kind = boardFieldKind(board.priority_type);

  if (board.default_priority_id) {
    const stored = await loadPriority(conn, tenant, board.default_priority_id);
    const storedFits =
      stored &&
      (stored.item_type ?? 'ticket') === 'ticket' &&
      Boolean(stored.is_from_itil_standard) === (kind === 'itil');
    if (storedFits) return board.default_priority_id;
  }

  if (kind === 'itil') {
    return resolveItilPriorityIdForLevel(conn, tenant, 3);
  }

  const [lowest] = await listPrioritiesForKind(conn, tenant, 'custom', 'ticket');
  return lowest?.priority_id ?? null;
}

export type BoardFieldPolicy = 'refuse' | 'fallback';

export interface ResolveTicketPriorityInput {
  boardId: string | null | undefined;
  /** Omit the key entirely when the write does not touch the priority. */
  priorityId?: string | null;
  itilImpact?: number | null;
  itilUrgency?: number | null;
  /** The stored ticket on an update; omit for a create. */
  current?: { priority_id?: string | null; itil_impact?: number | null; itil_urgency?: number | null };
  policy: BoardFieldPolicy;
}

export interface ResolvedTicketPriorityFields {
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  problems: BoardFieldProblem[];
}

/**
 * R4 and R6 in one place: the priority, Impact and Urgency a write should store.
 *
 * On an ITIL board, Impact and Urgency decide the priority and a supplied `priority_id` is
 * ignored. Only one of them is refused interactively and dropped on automated paths. A priority
 * supplied on its own is accepted when it is an ITIL priority, and clears a stored assessment
 * (D5). On a board with the tenant's own priorities, Impact and Urgency are never stored.
 *
 * With `policy: 'fallback'` nothing is refused: the configured priority is used when it fits the
 * board, otherwise the board's default (R7), otherwise the configured priority unchanged.
 */
export async function resolveTicketPriorityFields(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: ResolveTicketPriorityInput
): Promise<ResolvedTicketPriorityFields> {
  const suppliedPriority = supplied(input, 'priorityId');
  const candidatePriorityId = (suppliedPriority ? input.priorityId : input.current?.priority_id) ?? null;
  const board = input.boardId ? await loadBoard(conn, tenant, input.boardId) : null;
  const kind = boardFieldKind(board?.priority_type);

  if (!board || kind !== 'itil') {
    // Impact and Urgency are not stored on a board with the tenant's own priorities.
    return {
      ...(await resolvePlainPriority(conn, tenant, board, candidatePriorityId, input.policy)),
      itil_impact: null,
      itil_urgency: null,
    };
  }

  const priorityChanged =
    suppliedPriority && (input.priorityId ?? null) !== (input.current?.priority_id ?? null);
  const suppliedAssessment = supplied(input, 'itilImpact') || supplied(input, 'itilUrgency');
  // D5: a write that only moves the priority is a direct priority change. The stored assessment is
  // not fed back into the matrix — it is cleared below — otherwise the ticket would snap back to
  // the priority the old Impact × Urgency pair computes.
  const directPriorityChange = priorityChanged && !suppliedAssessment;

  const impact = directPriorityChange
    ? null
    : normaliseLevel(supplied(input, 'itilImpact') ? input.itilImpact : input.current?.itil_impact);
  const urgency = directPriorityChange
    ? null
    : normaliseLevel(supplied(input, 'itilUrgency') ? input.itilUrgency : input.current?.itil_urgency);

  if (impact !== null && urgency !== null) {
    const matrixPriorityId = await resolveItilPriorityId(conn, tenant, impact, urgency);
    if (matrixPriorityId) {
      return { priority_id: matrixPriorityId, itil_impact: impact, itil_urgency: urgency, problems: [] };
    }
    // The tenant has no ITIL priority for the computed level: treat the assessment as unusable
    // rather than storing a half-assessed ticket.
    if (input.policy === 'refuse') {
      return {
        priority_id: candidatePriorityId,
        itil_impact: null,
        itil_urgency: null,
        problems: [
          {
            field: 'priority_id',
            message: `Board ‘${board.board_name}’ uses ITIL priorities but the tenant has none for this impact and urgency`,
            messageKey: 'features/tickets:errors.ticket.itilPriorityMissingForAssessment',
            messageParams: { board: board.board_name },
          },
        ],
      };
    }
    return {
      ...(await resolvePlainPriority(conn, tenant, board, candidatePriorityId, 'fallback')),
      itil_impact: null,
      itil_urgency: null,
    };
  }

  if ((impact === null) !== (urgency === null)) {
    if (input.policy === 'refuse') {
      return {
        priority_id: candidatePriorityId,
        itil_impact: impact,
        itil_urgency: urgency,
        problems: [
          {
            field: impact === null ? 'itil_impact' : 'itil_urgency',
            message: 'Impact and urgency must be set together on a board that uses ITIL priorities.',
            messageKey: 'features/tickets:errors.ticket.impactUrgencyTogether',
          },
        ],
      };
    }
    return {
      ...(await resolvePlainPriority(conn, tenant, board, candidatePriorityId, 'fallback')),
      itil_impact: null,
      itil_urgency: null,
    };
  }

  // A priority on its own. D5: a direct priority change clears a stored assessment.
  const resolved = await resolvePlainPriority(conn, tenant, board, candidatePriorityId, input.policy);
  const storedImpact = normaliseLevel(input.current?.itil_impact);
  const storedUrgency = normaliseLevel(input.current?.itil_urgency);
  const keepAssessment = !priorityChanged && resolved.problems.length === 0;
  return {
    ...resolved,
    itil_impact: keepAssessment ? storedImpact : null,
    itil_urgency: keepAssessment ? storedUrgency : null,
  };
}

function normaliseLevel(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const level = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(level) || level < 1 || level > 5) return null;
  return level;
}

/** The priority half of {@link resolveTicketPriorityFields}: check it, or fall back (R6). */
async function resolvePlainPriority(
  conn: Knex | Knex.Transaction,
  tenant: string,
  board: BoardFieldBoard | null,
  candidatePriorityId: string | null,
  policy: BoardFieldPolicy
): Promise<{ priority_id: string | null; problems: BoardFieldProblem[] }> {
  if (!board) return { priority_id: candidatePriorityId, problems: [] };

  if (candidatePriorityId) {
    const problems = await findBoardFieldProblems(conn, tenant, {
      boardId: board.board_id,
      priorityId: candidatePriorityId,
    });
    if (problems.length === 0) return { priority_id: candidatePriorityId, problems: [] };
    if (policy === 'refuse') return { priority_id: candidatePriorityId, problems };
  } else if (policy === 'refuse') {
    return { priority_id: null, problems: [] };
  }

  const fallback = await defaultPriorityForBoardRow(conn, tenant, board);
  return { priority_id: fallback ?? candidatePriorityId, problems: [] };
}

/** Marks every refusal this module raises, whichever module instance threw it (see `code`). */
export const BOARD_FIELD_RULE_ERROR_CODE = 'BOARD_FIELD_RULE';

/**
 * A refused board-owned field (R6), thrown by the lowest layer that knows: `TicketModel` and the
 * writers that call the rules directly. `packages/tickets` extends it as `TicketBoardFieldError`
 * so a server action reports it as a field error; use {@link isBoardFieldRuleError} to recognise
 * it, because Next bundles the shared module separately for startup code and server actions and
 * `instanceof` across two instances is not reliable.
 */
export class BoardFieldRuleError extends Error {
  readonly code = BOARD_FIELD_RULE_ERROR_CODE;
  readonly field: BoardFieldProblem['field'];
  readonly messageKey?: string;
  readonly messageParams?: Record<string, string>;

  constructor(problem: BoardFieldProblem) {
    super(problem.message);
    this.name = 'BoardFieldRuleError';
    this.field = problem.field;
    this.messageKey = problem.messageKey;
    this.messageParams = problem.messageParams;
  }
}

export function isBoardFieldRuleError(error: unknown): error is BoardFieldRuleError {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === BOARD_FIELD_RULE_ERROR_CODE &&
    typeof (error as { field?: unknown }).field === 'string'
  );
}

export interface PrepareTicketFieldsInput extends ResolveTicketPriorityInput {
  categoryId?: string | null;
  subcategoryId?: string | null;
}

export interface PreparedTicketFields {
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  category_id: string | null;
  subcategory_id: string | null;
  problems: BoardFieldProblem[];
}

/**
 * The one answer to "what should this create store for board, priority, Impact, Urgency, category
 * and subcategory?" — R2, R4, R6 and R7 together, so every create path asks the same question.
 *
 * A standard category of another board is translated to this board's copy first (R2), on refuse and
 * on fall-back paths alike. With `policy: 'refuse'` the problems are returned for the caller to
 * raise against the field; with `policy: 'fallback'` nothing is refused — the priority falls back to
 * the board's default and a category that does not belong to the board is dropped, never the ticket.
 */
export async function prepareTicketCreateFields(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: PrepareTicketFieldsInput
): Promise<PreparedTicketFields> {
  const { categoryId, subcategoryId } = await translateStandardCategoryPairForBoard(
    conn,
    tenant,
    input.boardId,
    input.categoryId,
    input.subcategoryId
  );

  const priority = await resolveTicketPriorityFields(conn, tenant, input);

  const categoryProblems = await findBoardFieldProblems(conn, tenant, {
    boardId: input.boardId,
    categoryId,
    subcategoryId,
  });

  if (input.policy === 'refuse') {
    return {
      priority_id: priority.priority_id,
      itil_impact: priority.itil_impact,
      itil_urgency: priority.itil_urgency,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      problems: [...priority.problems, ...categoryProblems],
    };
  }

  // R6 fall-back: a category that does not belong to the board is dropped. A subcategory goes with
  // its category, because a subcategory on its own is not a value R2 accepts.
  const categoryRefused = categoryProblems.some((problem) => problem.field === 'category_id');
  const subcategoryRefused = categoryProblems.some((problem) => problem.field === 'subcategory_id');
  return {
    priority_id: priority.priority_id,
    itil_impact: priority.itil_impact,
    itil_urgency: priority.itil_urgency,
    category_id: categoryRefused ? null : categoryId,
    subcategory_id: categoryRefused || subcategoryRefused ? null : subcategoryId,
    problems: [],
  };
}

/** {@link prepareTicketCreateFields}, raising the first problem instead of returning it. */
export async function prepareTicketCreateFieldsOrThrow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: PrepareTicketFieldsInput
): Promise<PreparedTicketFields> {
  const prepared = await prepareTicketCreateFields(conn, tenant, input);
  const [problem] = prepared.problems;
  if (problem) throw new BoardFieldRuleError(problem);
  return prepared;
}
