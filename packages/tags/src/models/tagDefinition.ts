import type { TaggedEntityType } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export interface ITagDefinition {
  tenant: string;
  tag_id: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  board_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
}

const TagDefinition = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITagDefinition[]> => {
    const definitions = await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tenant', tenant)
      .orderBy('tag_text', 'asc');
    return definitions;
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<ITagDefinition | undefined> => {
    const definition = await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tag_id', tag_id)
      .where('tenant', tenant)
      .first();
    return definition;
  },

  findByTextAndType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_text: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition | undefined> => {
    const definition = await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tag_text', tag_text.trim())
      .where('tagged_type', tagged_type)
      .where('tenant', tenant)
      .first();
    return definition;
  },

  getAllByType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition[]> => {
    const definitions = await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tagged_type', tagged_type)
      .where('tenant', tenant)
      .orderBy('tag_text', 'asc');
    return definitions;
  },

  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    definition: Omit<ITagDefinition, 'tag_id' | 'tenant' | 'created_at'>
  ): Promise<ITagDefinition> => {
    const normalizedDefinition = {
      ...definition,
      tag_text: definition.tag_text.trim(),
      tag_id: uuidv4(),
      tenant
    };

    const [inserted] = await knexOrTrx<ITagDefinition>('tag_definitions')
      .insert(normalizedDefinition)
      .returning('*');
    return inserted;
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_id: string,
    updates: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tagged_type'>>
  ): Promise<void> => {
    if (updates.tag_text) {
      updates.tag_text = updates.tag_text.trim();
    }

    await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tag_id', tag_id)
      .where('tenant', tenant)
      .update(updates);
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tag_id: string): Promise<void> => {
    await knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tag_id', tag_id)
      .where('tenant', tenant)
      .del();
  },

  getOrCreate: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tag_text: string,
    tagged_type: TaggedEntityType,
    defaults: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tag_text' | 'tagged_type'>> = {}
  ): Promise<ITagDefinition> => {
    let definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tag_text, tagged_type);

    if (!definition) {
      try {
        definition = await TagDefinition.insert(knexOrTrx, tenant, {
          tag_text,
          tagged_type,
          ...defaults
        });
      } catch (insertError: any) {
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tag_text, tagged_type);
          if (!definition) {
            throw insertError;
          }
        } else {
          throw insertError;
        }
      }
    }

    return definition;
  }
};

export default TagDefinition;

