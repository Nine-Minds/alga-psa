import type { TaggedEntityType } from '@alga-psa/types';
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

const TagMapping = {
  getByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagWithDefinition[]> => {
    const tags = await knexOrTrx('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
          .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where('tm.tenant', tenant)
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
      .orderBy('td.tag_text', 'asc');

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

    const tags = await knexOrTrx('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
          .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where('tm.tenant', tenant)
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
      );

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

    const [inserted] = await knexOrTrx<ITagMapping>('tag_mappings')
      .insert(fullMapping)
      .returning('*');

    return inserted;
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, mapping_id: string): Promise<void> => {
    await knexOrTrx<ITagMapping>('tag_mappings')
      .where('mapping_id', mapping_id)
      .where('tenant', tenant)
      .del();
  },

  deleteByTagId: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<number> => {
    const deleted = await knexOrTrx<ITagMapping>('tag_mappings')
      .where('tag_id', tag_id)
      .where('tenant', tenant)
      .del();
    return deleted;
  },

  deleteByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<number> => {
    const deleted = await knexOrTrx<ITagMapping>('tag_mappings')
      .where('tagged_id', tagged_id)
      .where('tagged_type', tagged_type)
      .where('tenant', tenant)
      .del();
    return deleted;
  },

  exists: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    tagged_id: string
  ): Promise<boolean> => {
    const mapping = await knexOrTrx<ITagMapping>('tag_mappings')
      .where('tag_id', tag_id)
      .where('tagged_id', tagged_id)
      .where('tenant', tenant)
      .first();

    return !!mapping;
  },

  getUsageCount: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<number> => {
    const result = await knexOrTrx('tag_mappings')
      .where('tag_id', tag_id)
      .where('tenant', tenant)
      .count('* as count')
      .first();

    return Number(result?.count || 0);
  },

  getEntitiesByTag: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    tagged_type?: TaggedEntityType
  ): Promise<Array<{ tagged_id: string; tagged_type: TaggedEntityType }>> => {
    let query = knexOrTrx<ITagMapping>('tag_mappings')
      .where('tag_id', tag_id)
      .where('tenant', tenant);

    if (tagged_type) {
      query = query.where('tagged_type', tagged_type);
    }

    const entities = await query.select('tagged_id', 'tagged_type');

    return entities;
  }
};

export default TagMapping;

