import type { Knex } from 'knex';

import { flattenBlockNote, truncateForIndex } from '../normalize';
import type { EntityIndexer, SearchDoc } from '../types';

interface DocumentSearchRow {
  document_id: string;
  document_name: string;
  content: string | null;
  client_id: string | null;
  entered_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: DocumentSearchRow): Date {
  const value = row.updated_at ?? row.entered_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: DocumentSearchRow): SearchDoc {
  const body = row.content ? truncateForIndex(flattenBlockNote(row.content)) : undefined;

  return {
    tenant,
    objectType: 'document',
    objectId: row.document_id,
    title: row.document_name,
    body,
    url: `/msp/documents/${row.document_id}`,
    acl: {
      requiredPermission: 'document:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const documentIndexer: EntityIndexer = {
  objectType: 'document',
  sourceEvents: ['DOCUMENT_UPLOADED', 'DOCUMENT_GENERATED', 'DOCUMENT_ASSOCIATED', 'DOCUMENT_DETACHED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<DocumentSearchRow>('documents')
      .select('document_id', 'document_name', 'content', 'client_id', 'entered_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('document_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<DocumentSearchRow>('documents')
      .select('document_id', 'document_name', 'content', 'client_id', 'entered_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('document_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('document_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
