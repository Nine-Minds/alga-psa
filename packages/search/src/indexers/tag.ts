import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface TagSearchRow {
  tag_id: string;
  tag_text: string;
  tagged_type: string | null;
  board_id: string | null;
  created_at?: Date | string | null;
}

function humanizeTaggedType(taggedType: string): string {
  const normalized = taggedType.replace(/_/g, ' ').trim();
  const label = normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : taggedType;
  return `${label} tag`;
}

function toSearchDoc(tenant: string, row: TagSearchRow): SearchDoc {
  const metadata: Record<string, unknown> = {};
  if (row.tagged_type) {
    metadata.tagged_type = row.tagged_type;
  }
  if (row.board_id) {
    metadata.board_id = row.board_id;
  }

  return {
    tenant,
    objectType: 'tag',
    objectId: row.tag_id,
    title: row.tag_text,
    subtitle: row.tagged_type ? humanizeTaggedType(row.tagged_type) : undefined,
    url: `/msp/tickets?tags=${encodeURIComponent(row.tag_text)}`,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    acl: {
      requiredPermission: 'ticket:read',
    },
    sourceUpdatedAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export const tagIndexer: EntityIndexer = {
  objectType: 'tag',
  sourceEvents: [
    'TAG_DEFINITION_CREATED',
    'TAG_DEFINITION_UPDATED',
    'TAG_DEFINITION_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<TagSearchRow>(knex, 'tag_definitions', 'tag_definitions', tenant)
      .select('tag_id', 'tag_text', 'tagged_type', 'board_id', 'created_at')
      .andWhere('tag_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<TagSearchRow>(knex, 'tag_definitions', 'tag_definitions', tenant)
      .select('tag_id', 'tag_text', 'tagged_type', 'board_id', 'created_at')
      .orderBy('tag_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('tag_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
