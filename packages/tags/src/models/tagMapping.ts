import type { TaggedEntityType } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export interface ITagMapping {
  tenant: string;
  mapping_id: string;
  tag_id: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  created_at?: Date;
  created_by?: string | null;
}

export interface ITagWithDefinition {
  mapping_id: string;
  tag_id: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  board_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
  created_by?: string | null;
}

const tagMappingsQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_mappings');

const aliasedTagMappingsQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  tenantDb(knexOrTrx, tenant).table('tag_mappings as tm');

const joinTagDefinitions = (
  query: Knex.QueryBuilder,
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
) => tenantDb(knexOrTrx, tenant).tenantJoin(query, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');

const TagMapping = {
  getByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagWithDefinition[]> => {
    const tags = await aliasedTagMappingsQuery(knexOrTrx, tenant)
      .modify((query) => joinTagDefinitions(query, knexOrTrx, tenant))
      .where('tm.tagged_id', tagged_id)
      .where('tm.tagged_type', tagged_type)
      .select(
        'tm.mapping_id',
        'td.tag_id',
        'td.tag_text',
        'tm.tagged_id',
        'tm.tagged_type',
        'td.board_id',
        'td.background_color',
        'td.text_color',
        'tm.created_at',
        'tm.created_by'
      )
      .orderBy('td.tag_text', 'asc') as ITagWithDefinition[];

    return tags;
  },

  getByEntities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_ids: string[],
    tagged_type: TaggedEntityType
  ): Promise<ITagWithDefinition[]> => {
    if (tagged_ids.length === 0) {
      return [];
    }

    const tags = await aliasedTagMappingsQuery(knexOrTrx, tenant)
      .modify((query) => joinTagDefinitions(query, knexOrTrx, tenant))
      .whereIn('tm.tagged_id', tagged_ids)
      .where('tm.tagged_type', tagged_type)
      .select(
        'tm.mapping_id',
        'td.tag_id',
        'td.tag_text',
        'tm.tagged_id',
        'tm.tagged_type',
        'td.board_id',
        'td.background_color',
        'td.text_color',
        'tm.created_at',
        'tm.created_by'
      ) as ITagWithDefinition[];

    return tags;
  },

  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    mapping: Omit<ITagMapping, 'mapping_id' | 'tenant' | 'created_at'>,
    userId?: string
  ): Promise<ITagMapping> => {
    const fullMapping = {
      ...mapping,
      mapping_id: uuidv4(),
      tenant,
      created_by: userId || mapping.created_by || null
    };

    const [inserted] = await tenantDb(knexOrTrx, tenant).table<ITagMapping>('tag_mappings')
      .insert(fullMapping)
      .returning('*');

    return inserted;
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, mapping_id: string): Promise<void> => {
    await tagMappingsQuery(knexOrTrx, tenant)
      .where('mapping_id', mapping_id)
      .del();
  },

  deleteByTagId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<number> => {
    const deleted = await tagMappingsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .del();
    return deleted;
  },

  deleteByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<number> => {
    const deleted = await tagMappingsQuery(knexOrTrx, tenant)
      .where('tagged_id', tagged_id)
      .where('tagged_type', tagged_type)
      .del();
    return deleted;
  },

  exists: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    tagged_id: string
  ): Promise<boolean> => {
    const mapping = await tagMappingsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .where('tagged_id', tagged_id)
      .first() as ITagMapping | undefined;

    return !!mapping;
  },

  getUsageCount: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<number> => {
    const result = await tagMappingsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id)
      .count('* as count')
      .first() as { count?: string | number } | undefined;

    return Number(result?.count || 0);
  },

  getEntitiesByTag: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    tagged_type?: TaggedEntityType
  ): Promise<Array<{ tagged_id: string; tagged_type: TaggedEntityType }>> => {
    let query = tagMappingsQuery(knexOrTrx, tenant)
      .where('tag_id', tag_id);

    if (tagged_type) {
      query = query.where('tagged_type', tagged_type);
    }

    const entities = await query.select('tagged_id', 'tagged_type') as Array<{
      tagged_id: string;
      tagged_type: TaggedEntityType;
    }>;

    return entities;
  }
};

export default TagMapping;
