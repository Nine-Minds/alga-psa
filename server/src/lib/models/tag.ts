// server/src/lib/models/tag.ts
import { getCurrentTenantId } from '../db';
import { ITag, TaggedEntityType } from '../../interfaces/tag.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';

const Tag = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITag[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const tags = await knexOrTrx<ITag>('tags')
        .where('tenant', tenant)
        .select('*');
      return tags;
    } catch (error) {
      console.error('Error getting all tags:', error);
      throw error;
    }
  },

  getAllByEntityId: async (knexOrTrx: Knex | Knex.Transaction, tagged_id: string, tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const tags = await knexOrTrx<ITag>('tags')
        .where('tagged_id', tagged_id)
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .select('*');
      return tags;
    } catch (error) {
      console.error(`Error getting tags for ${tagged_type} with id ${tagged_id}:`, error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<ITag | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const tag = await knexOrTrx<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .first();
      return tag;
    } catch (error) {
      console.error(`Error getting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<Pick<ITag, "tag_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const [insertedTag] = await knexOrTrx<ITag>('tags')
        .insert({ ...tag, tag_id: uuidv4(), tenant })
        .returning('tag_id');
      return { tag_id: insertedTag.tag_id };
    } catch (error) {
      console.error('Error inserting tag:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string, tag: Partial<ITag>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      await knexOrTrx<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .update(tag);
    } catch (error) {
      console.error(`Error updating tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      await knexOrTrx<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  getAllByEntityIds: async (knexOrTrx: Knex | Knex.Transaction, tagged_ids: string[], tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const tags = await knexOrTrx<ITag>('tags')
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .whereIn('tagged_id', tagged_ids)
        .select('*');
      return tags;
    } catch (error) {
      console.error(`Error getting tags for multiple ${tagged_type}s:`, error);
      throw error;
    }
  },

  getAllUniqueTagsByType: async (knexOrTrx: Knex | Knex.Transaction, tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const tags = await knexOrTrx<ITag>('tags')
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .distinctOn('tag_text')
        .orderBy('tag_text');
      return tags;
    } catch (error) {
      console.error(`Error getting unique tags for type ${tagged_type}:`, error);
      throw error;
    }
  },

  getAllUniqueTagTextsByType: async (knexOrTrx: Knex | Knex.Transaction, tagged_type: TaggedEntityType): Promise<string[]> => {
    const tags = await Tag.getAllUniqueTagsByType(knexOrTrx, tagged_type);
    return tags.map((t) => t.tag_text);
  },

  updateColorByText: async (knexOrTrx: Knex | Knex.Transaction, tag_text: string, tagged_type: TaggedEntityType, background_color: string | null, text_color: string | null): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      await knexOrTrx<ITag>('tags')
        .where('tag_text', tag_text)
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .update({
          background_color,
          text_color,
        });
    } catch (error) {
      console.error(`Error updating color for tags with text "${tag_text}" and type "${tagged_type}":`, error);
      throw error;
    }
  }
};

export default Tag;
