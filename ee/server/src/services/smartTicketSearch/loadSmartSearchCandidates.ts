/**
 * Builds the per-ticket text Jev sees.
 *
 * Title, number, client, description, and the ticket's current facts (status,
 * closed flag, priority, board, assignee, team, dates) come from `tickets` and
 * its lookups (the description lives in `attributes.description` and is not in
 * the search index). Comments
 * come from `app_search_index` rows of type `ticket_comment`, already flattened
 * to plain text and carrying the same visibility columns keyword search filters
 * on, so a client-portal user's smart search never sees an internal note.
 *
 * Budgeting is deliberate: the description is truncated first, then comments
 * are added newest-first until the per-ticket budget is spent. Everything older
 * is dropped. The numbers live in smartSearchBudgets.ts.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { aclPredicateSql, resolveSearchAclPrincipal, type SearchAclPrincipal } from '@alga-psa/search/acl';
import { flattenBlockNote, flattenMarkdown } from '@alga-psa/search/normalize';
import type { IUserWithRoles } from '@alga-psa/types';

import { SMART_SEARCH_BUDGETS, approxTokens, charsForTokens } from './smartSearchBudgets';

export type SmartSearchCommentAuthor = 'technician' | 'client' | 'system';

export interface SmartSearchCandidateComment {
  author: SmartSearchCommentAuthor;
  text: string;
}

/**
 * Current facts about the ticket, as named text so Jev reads them the way a
 * technician would (a status name, not an id; an ISO date, not an epoch). The
 * chips already filter on these; they are here so a query like "closed last
 * week by Sam" or "urgent on the Projects board" can be judged against them.
 */
export interface SmartSearchCandidateFacts {
  status: string | null;
  isClosed: boolean;
  priority: string | null;
  board: string | null;
  assignedTo: string | null;
  assignedTeam: string | null;
  /** ISO 8601 date-times, or null. */
  enteredAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  dueDate: string | null;
}

export interface SmartSearchCandidate {
  ticketId: string;
  ticketNumber: string;
  title: string;
  clientName: string | null;
  facts: SmartSearchCandidateFacts;
  /** Plain text, already trimmed to budget. */
  description: string;
  /** Newest first, already trimmed to budget. */
  comments: SmartSearchCandidateComment[];
  approxTokens: number;
}

export interface CandidateBudgets {
  tokensPerTicket: number;
  descriptionMaxTokens: number;
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

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function toCandidateFacts(row: TicketTextRow): SmartSearchCandidateFacts {
  return {
    status: nonEmpty(row.status_name),
    isClosed: row.is_closed === true,
    priority: nonEmpty(row.priority_name),
    board: nonEmpty(row.board_name),
    assignedTo: nonEmpty(row.assigned_to_name),
    assignedTeam: nonEmpty(row.assigned_team_name),
    enteredAt: toIso(row.entered_at),
    updatedAt: toIso(row.updated_at),
    closedAt: toIso(row.closed_at),
    dueDate: toIso(row.due_date),
  };
}

interface CommentIndexRow {
  parent_id: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  source_updated_at: Date | string;
}

function normalizeDescription(raw: string | null): string {
  const value = raw?.trim() ?? '';
  if (!value) {
    return '';
  }
  const looksLikeBlockNoteJson = value.startsWith('[') || value.startsWith('{');
  return (looksLikeBlockNoteJson ? flattenBlockNote(value) : flattenMarkdown(value)).trim();
}

/** Cut at the last sentence end (or word) inside `maxChars`; append an ellipsis. */
export function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const window = text.slice(0, maxChars);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  const cutAt = sentenceEnd >= maxChars * 0.5
    ? sentenceEnd + 1
    : Math.max(window.lastIndexOf(' '), Math.floor(maxChars * 0.8));
  return `${window.slice(0, cutAt).trimEnd()} …`;
}

function toAuthor(metadata: Record<string, unknown> | null): SmartSearchCommentAuthor {
  const kind = metadata?.author_kind;
  return kind === 'client' || kind === 'system' ? kind : 'technician';
}

/**
 * Pure budgeting step, exported for tests. `comments` must be newest first.
 */
export function assembleCandidate(
  row: TicketTextRow,
  comments: SmartSearchCandidateComment[],
  budgets: CandidateBudgets = SMART_SEARCH_BUDGETS
): SmartSearchCandidate {
  const title = row.title?.trim() || row.ticket_number || row.ticket_id;
  const ticketNumber = row.ticket_number ?? '';
  const clientName = row.client_name?.trim() || null;
  const description = truncateAtBoundary(
    normalizeDescription(row.description),
    charsForTokens(budgets.descriptionMaxTokens)
  );

  const facts = toCandidateFacts(row);
  let used =
    approxTokens(title) +
    approxTokens(ticketNumber) +
    approxTokens(clientName ?? '') +
    approxTokens(JSON.stringify(facts)) +
    approxTokens(description);
  const kept: SmartSearchCandidateComment[] = [];

  for (const comment of comments) {
    const text = comment.text.trim();
    if (!text) {
      continue;
    }
    const remaining = budgets.tokensPerTicket - used;
    if (remaining <= 0) {
      break;
    }
    const cost = approxTokens(text);
    if (cost <= remaining) {
      kept.push({ author: comment.author, text });
      used += cost;
      continue;
    }
    // The newest comment that does not fit is truncated rather than dropped, so
    // the most recent state of the conversation always reaches the model.
    if (kept.length === 0) {
      const truncated = truncateAtBoundary(text, charsForTokens(remaining));
      kept.push({ author: comment.author, text: truncated });
      used += approxTokens(truncated);
    }
    break;
  }

  return {
    ticketId: row.ticket_id,
    ticketNumber,
    title,
    clientName,
    facts,
    description,
    comments: kept,
    approxTokens: used,
  };
}

async function loadTicketTextRows(
  trx: Knex.Transaction,
  tenant: string,
  ticketIds: string[]
): Promise<TicketTextRow[]> {
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
    .where('rn', '<=', SMART_SEARCH_BUDGETS.commentsPerTicketFetchLimit)
    .orderBy([{ column: 'parent_id' }, { column: 'source_updated_at', order: 'desc' }])
    .select('parent_id', 'body', 'metadata', 'source_updated_at');
}

export async function loadSmartSearchCandidates(
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

  const commentsByTicket = new Map<string, SmartSearchCandidateComment[]>();
  for (const row of commentRows) {
    const text = row.body?.trim();
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
    candidates.push(assembleCandidate(row, commentsByTicket.get(ticketId) ?? []));
  }
  return candidates;
}
