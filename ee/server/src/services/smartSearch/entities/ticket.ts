/**
 * Smart search over the Tickets list.
 *
 * Scope: the chip filters. Candidate text: title, number, client, description
 * (from `tickets.attributes.description`, not in the search index), the
 * ticket's current facts (status, closed flag, priority, board, assignee, team,
 * dates) as named text, and comments from `app_search_index` rows of type
 * `ticket_comment`, already flattened to plain text and carrying the same
 * visibility columns keyword search filters on, so a client-portal user's
 * smart search never sees an internal note.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { aclPredicateSql, resolveSearchAclPrincipal, type SearchAclPrincipal } from '@alga-psa/search/acl';
import { authorizeTicketIdsWithRedactions, getAllMatchingTicketIds, loadTicketListItemsByIds } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { ticketListFiltersSchema } from '@alga-psa/tickets/schemas/ticket.schema';
import type { TicketSmartSearchRowMetadata, TicketSmartSearchScope } from '@alga-psa/tickets/lib/smartTicketSearch/types';
import type { ITicketListItem, IUserWithRoles } from '@alga-psa/types';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

import { SMART_SEARCH_BUDGETS, type CandidateBudgets } from '../budgets';
import {
  assembleCandidate,
  fullName,
  nonEmpty,
  normalizeRichText,
  toIso,
  type CandidateChild,
  type SmartSearchCandidate,
} from '../candidate';
import type { SmartSearchEntityDefinition, SmartSearchRedactions } from '../entityDefinition';
import type { RelevancePrompt } from '../scoreBatch';

export type TicketCommentAuthor = 'technician' | 'client' | 'system';

export interface TicketComment {
  author: TicketCommentAuthor;
  text: string;
}

export interface TicketTextRow {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  description: string | null;
  client_name: string | null;
  status_name: string | null;
  is_closed: boolean | null;
  priority_name: string | null;
  board_name: string | null;
  assigned_to_name: string | null;
  assigned_team_name: string | null;
  entered_at: Date | string | null;
  updated_at: Date | string | null;
  closed_at: Date | string | null;
  due_date: Date | string | null;
}

interface CommentIndexRow {
  parent_id: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  source_updated_at: Date | string;
}

function toAuthor(metadata: Record<string, unknown> | null): TicketCommentAuthor {
  const kind = metadata?.author_kind;
  return kind === 'client' || kind === 'system' ? kind : 'technician';
}

/**
 * The JSON Jev reads for one ticket. Facts are named text so Jev reads them
 * the way a technician would (a status name, not an id; an ISO date, not an
 * epoch). The chips already filter on these; they are here so a query like
 * "closed last week by Sam" or "urgent on the Projects board" can be judged.
 * `comments` must be newest first. Exported for tests.
 */
export function assembleTicketCandidate(
  row: TicketTextRow,
  comments: TicketComment[],
  budgets: CandidateBudgets = SMART_SEARCH_BUDGETS
): SmartSearchCandidate {
  return assembleCandidate(
    {
      id: row.ticket_id,
      head: {
        ticket_number: row.ticket_number ?? '',
        title: row.title?.trim() || row.ticket_number || row.ticket_id,
        client: nonEmpty(row.client_name),
        status: nonEmpty(row.status_name),
        is_closed: row.is_closed === true,
        priority: nonEmpty(row.priority_name),
        board: nonEmpty(row.board_name),
        assigned_to: nonEmpty(row.assigned_to_name),
        assigned_team: nonEmpty(row.assigned_team_name),
        entered_at: toIso(row.entered_at),
        updated_at: toIso(row.updated_at),
        closed_at: toIso(row.closed_at),
        due_date: toIso(row.due_date),
      },
      description: row.description,
      sections: [
        {
          key: 'comments',
          items: comments
            .map((comment): CandidateChild => ({ author: comment.author, text: comment.text.trim() }))
            .filter((comment) => comment.text.length > 0),
        },
      ],
    },
    budgets
  );
}

function maskedColumn(trx: Knex.Transaction, hidden: ReadonlySet<string>, field: string, type: string, expression: string): Knex.Raw {
  return hidden.has(field) ? trx.raw(`NULL::${type} as ??`, [field]) : trx.raw(`${expression} as ??`, [field]);
}

async function loadTicketTextRows(trx: Knex.Transaction, tenant: string, ticketIds: string[], redactedFields: readonly string[]): Promise<TicketTextRow[]> {
  const hidden = new Set(redactedFields);
  if (hidden.has('tickets') || hidden.has('ticket_id')) return [];
  const db = tenantDb(trx, tenant);
  const query = db.table('tickets as t');
  db.tenantJoin(query, 'clients as comp', 't.client_id', 'comp.client_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
  db.tenantJoin(query, 'priorities as p', 't.priority_id', 'p.priority_id', {
    type: 'left',
    on: (join) => join.andOnVal('p.item_type', '=', 'ticket'),
  });
  db.tenantJoin(query, 'boards as b', 't.board_id', 'b.board_id', { type: 'left' });
  db.tenantJoin(query, 'users as au', 't.assigned_to', 'au.user_id', { type: 'left' });
  db.tenantJoin(query, 'teams as tm', 't.assigned_team_id', 'tm.team_id', { type: 'left' });
  return query
    .whereIn('t.ticket_id', ticketIds)
    .select(
      't.ticket_id',
      maskedColumn(trx, hidden, 'ticket_number', 'text', 't.ticket_number'),
      hidden.has('title') ? trx.raw("'Hidden ticket'::text as title") : 't.title',
      maskedColumn(trx, hidden, 'description', 'text', "t.attributes->>'description'"),
      maskedColumn(trx, hidden, 'client_name', 'text', 'comp.client_name'),
      maskedColumn(trx, hidden, 'status_name', 'text', 's.name'),
      maskedColumn(trx, hidden, 'is_closed', 'boolean', 's.is_closed'),
      maskedColumn(trx, hidden, 'priority_name', 'text', 'p.priority_name'),
      maskedColumn(trx, hidden, 'board_name', 'text', 'b.board_name'),
      maskedColumn(trx, hidden, 'assigned_to_name', 'text', "NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '')"),
      maskedColumn(trx, hidden, 'assigned_team_name', 'text', 'tm.team_name'),
      maskedColumn(trx, hidden, 'entered_at', 'timestamptz', 't.entered_at'),
      maskedColumn(trx, hidden, 'updated_at', 'timestamptz', 't.updated_at'),
      maskedColumn(trx, hidden, 'closed_at', 'timestamptz', 't.closed_at'),
      maskedColumn(trx, hidden, 'due_date', 'timestamptz', 't.due_date')
    );
}

async function loadVisibleCommentRows(
  trx: Knex.Transaction,
  tenant: string,
  principal: SearchAclPrincipal,
  ticketIds: string[],
  suppressComments: boolean
): Promise<CommentIndexRow[]> {
  if (suppressComments) return [];
  const acl = aclPredicateSql(principal);
  // Newest first per ticket, capped per ticket so a 400-comment thread does not
  // pull 400 rows the budget will throw away. ROW_NUMBER keeps the query one
  // round trip for the whole chunk; the outer filter is on the ranked set.
  const ranked = tenantDb(trx, tenant)
    .table('app_search_index as si')
    .where('si.object_type', 'ticket_comment')
    .whereIn('si.parent_id', ticketIds)
    .whereRaw(acl.sql, acl.bindings)
    .select(
      'si.parent_id',
      'si.body',
      'si.metadata',
      'si.source_updated_at',
      trx.raw('ROW_NUMBER() OVER (PARTITION BY si.parent_id ORDER BY si.source_updated_at DESC) AS rn')
    )
    .as('ranked');

  return trx
    .from(ranked)
    .where('rn', '<=', SMART_SEARCH_BUDGETS.childRowsPerCandidateFetchLimit)
    .orderBy([{ column: 'parent_id' }, { column: 'source_updated_at', order: 'desc' }])
    .select('parent_id', 'body', 'metadata', 'source_updated_at');
}

export async function loadTicketCandidates(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  ticketIds: string[],
  redactions: SmartSearchRedactions = new Map()
): Promise<SmartSearchCandidate[]> {
  if (ticketIds.length === 0) {
    return [];
  }
  const principal = await resolveSearchAclPrincipal(trx, user);
  const grouped = new Map<string, string[]>();
  for (const id of ticketIds) {
    const fields = [...new Set(redactions.get(id) ?? [])].sort();
    const key = JSON.stringify(fields);
    grouped.set(key, [...(grouped.get(key) ?? []), id]);
  }
  const ticketRows: TicketTextRow[] = [];
  const commentRows: CommentIndexRow[] = [];
  for (const [key, ids] of grouped) {
    const fields = JSON.parse(key) as string[];
    const [rows, comments] = await Promise.all([
      loadTicketTextRows(trx, tenant, ids, fields),
      loadVisibleCommentRows(trx, tenant, principal, ids, fields.length > 0),
    ]);
    ticketRows.push(...rows);
    commentRows.push(...comments);
  }

  const commentsByTicket = new Map<string, TicketComment[]>();
  for (const row of commentRows) {
    const text = normalizeRichText(row.body);
    if (!text) {
      continue;
    }
    const list = commentsByTicket.get(row.parent_id) ?? [];
    list.push({ author: toAuthor(row.metadata), text });
    commentsByTicket.set(row.parent_id, list);
  }

  const rowsById = new Map(ticketRows.map((row) => [row.ticket_id, row] as const));
  const candidates: SmartSearchCandidate[] = [];
  for (const ticketId of ticketIds) {
    const row = rowsById.get(ticketId);
    if (!row) {
      // Filtered out or deleted between enumeration and load; the runner
      // reports it as unscored rather than guessing.
      continue;
    }
    candidates.push(assembleTicketCandidate(row, commentsByTicket.get(ticketId) ?? []));
  }
  return candidates;
}

export const TICKET_RELEVANCE: RelevancePrompt = {
  question: (ref, index) =>
    `Is the support ticket with ref \`${ref}\` (at \`candidates[${index}]\`) about the ` +
    'problem, request, person, device, or subject described by `query`, judging from its ' +
    'title, description, and comments? Judge only that candidate. A ticket whose title, ' +
    'description, and comments say nothing about what `query` describes is not about it. ' +
    'The candidate also carries its current status, is_closed flag, priority, board, ' +
    'assigned_to, assigned_team, and entered_at, updated_at, closed_at, and due_date as ' +
    'ISO 8601 date-times; use those only when `query` refers to such things.',
  criteria: {
    true:
      'The ticket concerns what the query describes, even when it uses different words, ' +
      'names a specific product or vendor where the query names a category, or describes ' +
      'a symptom of the same underlying problem. When the query mentions a status, whether ' +
      'the ticket is closed, a priority, a board, an assignee or team, or a time such as a ' +
      'due date or when it was opened, updated, or closed, the ticket matches on those too.',
    false:
      'The ticket is about a different problem, request, or subject, or its title, description, ' +
      'and comments say nothing about what the query describes, or the query names a status, ' +
      'closed state, priority, board, assignee, team, or time that the ticket does not match. ' +
      'An empty description with no comments is not evidence of relevance. Sharing a client, a ' +
      'technician, a device type, or a few incidental words the query does not ask about does ' +
      'not make it relevant.',
  },
};

export const ticketSmartSearch: SmartSearchEntityDefinition<TicketSmartSearchScope, ITicketListItem, TicketSmartSearchRowMetadata> = {
  entity: 'ticket',
  permissionResource: 'ticket',
  noun: 'tickets',
  scopeSchema: ticketListFiltersSchema,
  normalizeScope: (scope) => ({ ...scope, searchQuery: '' }),
  enumerate: async (scope) => {
    const ids = await getAllMatchingTicketIds(scope);
    if (!Array.isArray(ids)) return ids;
    const authorized = await authorizeTicketIdsWithRedactions(ids);
    if (isActionMessageError(authorized) || isActionPermissionError(authorized)) return authorized;
    return authorized.map(({ ticketId, redactedFields }) => ({ id: ticketId, redactedFields }));
  },
  loadCandidates: loadTicketCandidates,
  hydrateRows: async (scope, ids, originalRedactions) => {
    const result = await loadTicketListItemsByIds(scope, ids);
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      return result;
    }
    const fresh = await authorizeTicketIdsWithRedactions(ids);
    if (isActionMessageError(fresh) || isActionPermissionError(fresh)) return fresh;
    const byId = new Map(fresh.map(({ ticketId, redactedFields }) => [ticketId, new Set([...(originalRedactions.get(ticketId) ?? []), ...redactedFields])] as const));
    const rows = result.tickets.filter((ticket) => byId.has(ticket.ticket_id)).map((ticket) => {
      const hidden = byId.get(ticket.ticket_id)!;
      const copy = { ...ticket } as ITicketListItem;
      for (const field of hidden) {
        if (field === 'tickets' || field === 'ticket_id') return null;
        if (field === 'title') copy.title = 'Hidden ticket';
        else if (field === 'description') copy.attributes = { ...(copy.attributes ?? {}), description: null };
        else if (field in copy) (copy as unknown as Record<string, unknown>)[field] = null;
      }
      return copy;
    }).filter((ticket): ticket is ITicketListItem => ticket !== null);
    return { rows, metadata: result.metadata };
  },
  rowId: (ticket) => ticket.ticket_id as string,
  relevance: TICKET_RELEVANCE,
};
