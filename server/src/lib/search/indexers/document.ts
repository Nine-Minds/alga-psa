import type { Knex } from 'knex';

import { flattenBlockNote, truncateForIndex } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface DocumentSearchRow {
  document_id: string;
  document_name: string;
  content: string | null;
  block_data: unknown;
  side_content: string | null;
  entered_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: DocumentSearchRow): Date {
  const value = row.updated_at ?? row.entered_at;
  return value ? new Date(value) : new Date();
}

function resolveBody(row: DocumentSearchRow): string | undefined {
  const fragments: string[] = [];
  if (row.content && row.content.trim()) {
    fragments.push(flattenBlockNote(row.content));
  }
  if (row.side_content && row.side_content.trim()) {
    fragments.push(flattenBlockNote(row.side_content));
  }
  if (row.block_data) {
    const flattened = flattenBlockNote(row.block_data);
    if (flattened) {
      fragments.push(flattened);
    }
  }
  const joined = fragments.filter(Boolean).join(' ').trim();
  return joined ? truncateForIndex(joined) : undefined;
}

function toSearchDoc(tenant: string, row: DocumentSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'document',
    objectId: row.document_id,
    title: row.document_name,
    body: resolveBody(row),
    url: `/msp/documents?doc=${row.document_id}`,
    acl: {
      requiredPermission: 'document:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseDocumentQuery(knex: Knex, tenant: string) {
  return knex<DocumentSearchRow>('documents as d')
    .leftJoin('document_block_content as dbc', function () {
      this.on('dbc.tenant', 'd.tenant').andOn('dbc.document_id', 'd.document_id');
    })
    .leftJoin('document_content as dc', function () {
      this.on('dc.tenant', 'd.tenant').andOn('dc.document_id', 'd.document_id');
    })
    .select(
      'd.document_id',
      'd.document_name',
      'd.content',
      'd.entered_at',
      'd.updated_at',
      'dbc.block_data',
      'dc.content as side_content',
    )
    .where('d.tenant', tenant);
}

export const documentIndexer: EntityIndexer = {
  objectType: 'document',
  sourceEvents: [
    'DOCUMENT_UPLOADED',
    'DOCUMENT_UPDATED',
    'DOCUMENT_DELETED',
    'DOCUMENT_GENERATED',
    'DOCUMENT_ASSOCIATED',
    'DOCUMENT_DETACHED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseDocumentQuery(knex, tenant)
      .andWhere('d.document_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseDocumentQuery(knex, tenant)
      .orderBy('d.document_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('d.document_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
