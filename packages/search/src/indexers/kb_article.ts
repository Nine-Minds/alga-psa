import type { Knex } from 'knex';

import { flattenBlockNote, truncateForIndex } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface KbArticleSearchRow {
  article_id: string;
  document_id: string;
  document_name: string;
  content: string | null;
  updated_at?: Date | string | null;
  created_at?: Date | string | null;
  document_updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: KbArticleSearchRow): Date {
  const value = row.updated_at ?? row.document_updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: KbArticleSearchRow): SearchDoc {
  const body = row.content ? truncateForIndex(flattenBlockNote(row.content)) : undefined;

  return {
    tenant,
    objectType: 'kb_article',
    objectId: row.article_id,
    parentType: 'document',
    parentId: row.document_id,
    title: row.document_name,
    body,
    url: `/msp/knowledge-base/${row.article_id}`,
    acl: {
      requiredPermission: 'kb:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseKbArticleQuery(knex: Knex, tenant: string) {
  return knex<KbArticleSearchRow>('kb_articles as ka')
    .join('documents as d', function() {
      this.on('d.tenant', 'ka.tenant').andOn('d.document_id', 'ka.document_id');
    })
    .select(
      'ka.article_id',
      'ka.document_id',
      'ka.created_at',
      'ka.updated_at',
      'd.document_name',
      'd.content',
      'd.updated_at as document_updated_at',
    )
    .where('ka.tenant', tenant);
}

export const kbArticleIndexer: EntityIndexer = {
  objectType: 'kb_article',
  sourceEvents: ['KB_ARTICLE_CREATED', 'KB_ARTICLE_UPDATED', 'KB_ARTICLE_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseKbArticleQuery(knex, tenant)
      .andWhere('ka.article_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseKbArticleQuery(knex, tenant)
      .orderBy('ka.article_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('ka.article_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
