import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import { flattenBlockNote, flattenMarkdown } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface TicketCommentSearchRow {
  comment_id: string;
  ticket_id: string;
  note: string | null;
  markdown_content: string | null;
  is_internal: boolean | null;
  author_type: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  ticket_title: string | null;
  ticket_number: string | null;
}

function resolveCommentBody(row: TicketCommentSearchRow): string | undefined {
  if (row.markdown_content && row.markdown_content.trim()) {
    return flattenMarkdown(row.markdown_content);
  }
  const note = row.note?.trim();
  if (note) {
    const looksLikeBlockNoteJson = note.startsWith('[') || note.startsWith('{');
    return looksLikeBlockNoteJson ? flattenBlockNote(note) : flattenMarkdown(note);
  }
  return undefined;
}

/**
 * Who wrote the comment, as the reader of a ticket thread would classify it.
 * Recorded in `metadata.author_kind` so consumers that reason over the thread
 * (smart ticket search builds per-ticket state from these rows) can label each
 * comment without joining back to `comments`. Rows indexed before this field
 * existed carry no value; readers treat that as `technician`.
 */
export type SearchCommentAuthorKind = 'technician' | 'client' | 'system';

export function toCommentAuthorKind(authorType: string | null | undefined): SearchCommentAuthorKind {
  switch ((authorType ?? '').toLowerCase()) {
    case 'client':
    case 'contact':
      return 'client';
    case 'system':
      return 'system';
    default:
      return 'technician';
  }
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: TicketCommentSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: TicketCommentSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'ticket_comment',
    objectId: row.comment_id,
    parentType: 'ticket',
    parentId: row.ticket_id,
    title: row.ticket_title ?? row.ticket_number ?? row.ticket_id,
    subtitle: compactJoin([row.ticket_title, row.ticket_number]),
    body: resolveCommentBody(row),
    url: `/msp/tickets/${row.ticket_id}#comment-${row.comment_id}`,
    metadata: { author_kind: toCommentAuthorKind(row.author_type) },
    acl: {
      requiredPermission: 'ticket:read',
      isInternalOnly: row.is_internal ?? false,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseTicketCommentQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<TicketCommentSearchRow>(knex, 'comments as c', 'c', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'tickets as t', 't.ticket_id', 'c.ticket_id');

  return query
    .select(
      'c.comment_id',
      'c.ticket_id',
      'c.note',
      'c.markdown_content',
      'c.is_internal',
      'c.author_type',
      'c.created_at',
      'c.updated_at',
      't.title as ticket_title',
      't.ticket_number',
    );
}

export const ticketCommentIndexer: EntityIndexer = {
  objectType: 'ticket_comment',
  sourceEvents: ['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseTicketCommentQuery(knex, tenant)
      .andWhere('c.comment_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseTicketCommentQuery(knex, tenant)
      .orderBy('c.comment_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('c.comment_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
