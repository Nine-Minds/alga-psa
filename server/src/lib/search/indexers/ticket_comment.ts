import type { Knex } from 'knex';

import { flattenBlockNote, flattenMarkdown } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface TicketCommentSearchRow {
  comment_id: string;
  ticket_id: string;
  note: string | null;
  markdown_content: string | null;
  is_internal: boolean | null;
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
    acl: {
      requiredPermission: 'ticket:read',
      isInternalOnly: row.is_internal ?? false,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseTicketCommentQuery(knex: Knex, tenant: string) {
  return knex<TicketCommentSearchRow>('comments as c')
    .join('tickets as t', function() {
      this.on('t.tenant', 'c.tenant').andOn('t.ticket_id', 'c.ticket_id');
    })
    .select(
      'c.comment_id',
      'c.ticket_id',
      'c.note',
      'c.markdown_content',
      'c.is_internal',
      'c.created_at',
      'c.updated_at',
      't.title as ticket_title',
      't.ticket_number',
    )
    .where('c.tenant', tenant);
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
