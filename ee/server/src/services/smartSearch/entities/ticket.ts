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
import { getAllMatchingTicketIds, loadTicketListItemsByIds } from '@alga-psa/tickets/actions/optimizedTicketActions';
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
import type { SmartSearchEntityDefinition } from '../entityDefinition';
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

async function loadTicketTextRows(trx: Knex.Transaction, tenant: string, ticketIds: string[]): Promise<TicketTextRow[]> {
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
      't.ticket_number',
      't.title',
      trx.raw("t.attributes->>'description' as description"),
      'comp.client_name',
      's.name as status_name',
      's.is_closed',
      'p.priority_name',
      'b.board_name',
      trx.raw("NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '') as assigned_to_name"),
      'tm.team_name as assigned_team_name',
      't.entered_at',
      't.updated_at',
      't.closed_at',
      't.due_date'
    );
}

async function loadVisibleCommentRows(
  trx: Knex.Transaction,
  tenant: string,
  principal: SearchAclPrincipal,
  ticketIds: string[]
): Promise<CommentIndexRow[]> {
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
  ticketIds: string[]
): Promise<SmartSearchCandidate[]> {
  if (ticketIds.length === 0) {
    return [];
  }
  const principal = await resolveSearchAclPrincipal(trx, user);
  const [ticketRows, commentRows] = await Promise.all([
    loadTicketTextRows(trx, tenant, ticketIds),
    loadVisibleCommentRows(trx, tenant, principal, ticketIds),
  ]);

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
  question: (index) =>
    `Is the support ticket at \`candidates[${index}]\` about the problem, request, ` +
    'person, device, or subject described by `query`? The candidate carries its ' +
    'current status, is_closed flag, priority, board, assigned_to, assigned_team, and ' +
    'entered_at, updated_at, closed_at, and due_date as ISO 8601 date-times; use them ' +
    'only when `query` refers to such things.',
  criteria: {
    true:
      'The ticket concerns what the query describes, even when it uses different words, ' +
      'names a specific product or vendor where the query names a category, or describes ' +
      'a symptom of the same underlying problem. When the query mentions a status, whether ' +
      'the ticket is closed, a priority, a board, an assignee or team, or a time such as a ' +
      'due date or when it was opened, updated, or closed, the ticket matches on those too.',
    false:
      'The ticket is about a different problem, request, or subject, or the query names a ' +
      'status, closed state, priority, board, assignee, team, or time that the ticket does not ' +
      'match. Sharing a client, a technician, a device type, or a few incidental words the ' +
      'query does not ask about does not make it relevant.',
  },
};

export const ticketSmartSearch: SmartSearchEntityDefinition<TicketSmartSearchScope, ITicketListItem, TicketSmartSearchRowMetadata> = {
  entity: 'ticket',
  permissionResource: 'ticket',
  noun: 'tickets',
  scopeSchema: ticketListFiltersSchema,
  normalizeScope: (scope) => ({ ...scope, searchQuery: '' }),
  enumerate: (scope) => getAllMatchingTicketIds(scope),
  loadCandidates: loadTicketCandidates,
  hydrateRows: async (scope, ids) => {
    const result = await loadTicketListItemsByIds(scope, ids);
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      return result;
    }
    return { rows: result.tickets, metadata: result.metadata };
  },
  rowId: (ticket) => ticket.ticket_id as string,
  relevance: TICKET_RELEVANCE,
};
