/**
 * Curated ticket diff helper.
 *
 * Produces a structured `changes` object for ticket update activity rows.
 *
 * Why curated rather than column-wide?
 *  - V1 surfaces a user-meaningful operational timeline. Raw column-level
 *    diffs (e.g., `updated_at`, denormalized flags, attributes blob) would
 *    create noise and leak implementation details into UI history.
 *  - The curated list is centralized in `CURATED_TICKET_FIELDS` so future
 *    audit-worthy fields can be added in one place.
 *
 * No-op behavior:
 *  - Fields whose old and new values are deeply equal do not appear in the
 *    output. An update that touches only no-op fields therefore returns an
 *    empty object, which callers should treat as "no activity row needed".
 */

import type { Knex } from 'knex';

import {
  CURATED_TICKET_FIELDS,
  type CuratedTicketField,
  type TicketActivityChanges,
  type TicketActivityFieldChange,
} from './types';

type TicketLike = Record<string, unknown>;

function normalizeDateValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    // Many ticket date columns come back as ISO strings already; keep as-is.
    return value;
  }
  return value;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export interface LabelResolutionMap {
  status?: Map<string, string>;
  priority?: Map<string, string>;
  user?: Map<string, string>;
  team?: Map<string, string>;
  board?: Map<string, string>;
  category?: Map<string, string>;
  client?: Map<string, string>;
  contact?: Map<string, string>;
}

function labelFor(map: Map<string, string> | undefined, id: unknown): string | null {
  if (!map || id == null) return null;
  if (typeof id !== 'string') return null;
  return map.get(id) ?? null;
}

/**
 * Build a structured curated diff between current and proposed ticket state.
 *
 * @param current The current ticket row, e.g., fetched via `.first()`.
 * @param update  The validated update payload. Only keys present in this
 *                object are considered (an undefined value means "not being
 *                updated"; an explicit null means "set to null").
 * @param labels  Optional label resolution map. When provided, the result
 *                includes oldLabel/newLabel hints so the UI does not need to
 *                resolve IDs at render time.
 */
export function buildCuratedTicketDiff(
  current: TicketLike | null | undefined,
  update: TicketLike,
  labels?: LabelResolutionMap,
): TicketActivityChanges {
  if (!current) return {};
  const changes: TicketActivityChanges = {};

  for (const field of CURATED_TICKET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(update, field)) continue;
    const oldValueRaw = (current as Record<string, unknown>)[field];
    const newValueRaw = (update as Record<string, unknown>)[field];

    const oldValue =
      field === 'due_date' || field === 'closed_at'
        ? normalizeDateValue(oldValueRaw)
        : oldValueRaw;
    const newValue =
      field === 'due_date' || field === 'closed_at'
        ? normalizeDateValue(newValueRaw)
        : newValueRaw;

    if (isDeepEqual(oldValue, newValue)) continue;

    const entry: TicketActivityFieldChange = { old: oldValue ?? null, new: newValue ?? null };

    switch (field as CuratedTicketField) {
      case 'status_id':
        entry.oldLabel = labelFor(labels?.status, oldValue);
        entry.newLabel = labelFor(labels?.status, newValue);
        break;
      case 'priority_id':
        entry.oldLabel = labelFor(labels?.priority, oldValue);
        entry.newLabel = labelFor(labels?.priority, newValue);
        break;
      case 'assigned_to':
      case 'closed_by':
        entry.oldLabel = labelFor(labels?.user, oldValue);
        entry.newLabel = labelFor(labels?.user, newValue);
        break;
      case 'assigned_team_id':
        entry.oldLabel = labelFor(labels?.team, oldValue);
        entry.newLabel = labelFor(labels?.team, newValue);
        break;
      case 'board_id':
        entry.oldLabel = labelFor(labels?.board, oldValue);
        entry.newLabel = labelFor(labels?.board, newValue);
        break;
      case 'category_id':
      case 'subcategory_id':
        entry.oldLabel = labelFor(labels?.category, oldValue);
        entry.newLabel = labelFor(labels?.category, newValue);
        break;
      case 'client_id':
        entry.oldLabel = labelFor(labels?.client, oldValue);
        entry.newLabel = labelFor(labels?.client, newValue);
        break;
      case 'contact_name_id':
        entry.oldLabel = labelFor(labels?.contact, oldValue);
        entry.newLabel = labelFor(labels?.contact, newValue);
        break;
      default:
        break;
    }

    changes[field] = entry;
  }

  return changes;
}

export function hasCuratedChanges(changes: TicketActivityChanges | undefined): boolean {
  if (!changes) return false;
  return Object.keys(changes).length > 0;
}

/**
 * Convenience: derive a curated diff and asynchronously resolve labels for
 * the IDs that appear in the diff. Label lookups are best-effort.
 */
export async function buildCuratedTicketDiffWithLabels(
  knex: Knex | Knex.Transaction,
  tenant: string,
  current: TicketLike | null | undefined,
  update: TicketLike,
): Promise<TicketActivityChanges> {
  const naked = buildCuratedTicketDiff(current, update);
  if (!hasCuratedChanges(naked)) return naked;

  const labels: LabelResolutionMap = {};

  const collect = (field: CuratedTicketField): string[] => {
    const entry = naked[field];
    if (!entry) return [];
    const ids: string[] = [];
    if (typeof entry.old === 'string') ids.push(entry.old);
    if (typeof entry.new === 'string') ids.push(entry.new);
    return ids;
  };

  const tryResolve = async <T extends Record<string, unknown>>(
    table: string,
    idColumn: string,
    labelColumn: string,
    ids: string[],
  ): Promise<Map<string, string>> => {
    if (ids.length === 0) return new Map();
    try {
      const rows = await (knex as Knex)(table)
        .where({ tenant })
        .whereIn(idColumn, ids)
        .select(idColumn, labelColumn);
      const map = new Map<string, string>();
      for (const row of rows as T[]) {
        const id = row[idColumn];
        const label = row[labelColumn];
        if (typeof id === 'string' && typeof label === 'string') {
          map.set(id, label);
        }
      }
      return map;
    } catch (err) {
      console.warn(`[ticketActivity] label resolution failed for ${table}`, {
        tenant,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Map();
    }
  };

  const [statuses, priorities, users, teams, boards, categories, clients] = await Promise.all([
    tryResolve('statuses', 'status_id', 'name', collect('status_id')),
    tryResolve('priorities', 'priority_id', 'priority_name', collect('priority_id')),
    tryResolve('users', 'user_id', 'first_name', [
      ...collect('assigned_to'),
      ...collect('closed_by'),
    ]),
    tryResolve('teams', 'team_id', 'team_name', collect('assigned_team_id')),
    tryResolve('boards', 'board_id', 'board_name', collect('board_id')),
    tryResolve('categories', 'category_id', 'category_name', [
      ...collect('category_id'),
      ...collect('subcategory_id'),
    ]),
    tryResolve('clients', 'client_id', 'client_name', collect('client_id')),
  ]);

  labels.status = statuses;
  labels.priority = priorities;
  labels.user = users;
  labels.team = teams;
  labels.board = boards;
  labels.category = categories;
  labels.client = clients;

  return buildCuratedTicketDiff(current, update, labels);
}
