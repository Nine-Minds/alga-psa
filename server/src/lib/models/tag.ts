// server/src/lib/models/tag.ts
import { createTenantKnex } from '../db';
import { ITag, TaggedEntityType } from '../../interfaces/tag.interfaces';
import { v4 as uuidv4 } from 'uuid';

const Tag = {
  getAll: async (): Promise<ITag[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const tags = await db<ITag>('tags')
        .where('tenant', tenant!)
        .select('*');
      return tags;
    } catch (error) {
      console.error('Error getting all tags:', error);
      throw error;
    }
  },

  getAllByEntityId: async (tagged_id: string, tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const tags = await db<ITag>('tags')
        .where('tagged_id', tagged_id)
        .where('tagged_type', tagged_type)
        .where('tenant', tenant!)
        .select('*');
      return tags;
    } catch (error) {
      console.error(`Error getting tags for ${tagged_type} with id ${tagged_id}:`, error);
      throw error;
    }
  },

  get: async (tag_id: string): Promise<ITag | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const tag = await db<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant!)
        .first();
      return tag;
    } catch (error) {
      console.error(`Error getting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  insert: async (tag: Omit<ITag, 'tag_id' | 'tenant'>): Promise<Pick<ITag, "tag_id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const [insertedTag] = await db<ITag>('tags')
        .insert({ ...tag, tag_id: uuidv4(), tenant: tenant! })
        .returning('tag_id');
      return { tag_id: insertedTag.tag_id };
    } catch (error) {
      console.error('Error inserting tag:', error);
      throw error;
    }
  },

  update: async (tag_id: string, tag: Partial<ITag>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await db<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant!)
        .update(tag);
    } catch (error) {
      console.error(`Error updating tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  delete: async (tag_id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await db<ITag>('tags')
        .where('tag_id', tag_id)
        .where('tenant', tenant!)
        .del();
    } catch (error) {
      console.error(`Error deleting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  getAllByEntityIds: async (tagged_ids: string[], tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const tags = await db<ITag>('tags')
        .where('tagged_type', tagged_type)
        .where('tenant', tenant!)
        .whereIn('tagged_id', tagged_ids)
        .select('*');
      return tags;
    } catch (error) {
      console.error(`Error getting tags for multiple ${tagged_type}s:`, error);
      throw error;
    }
  },

  getAllUniqueTagTextsByType: async (tagged_type: TaggedEntityType): Promise<string[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const tags = await db<ITag>('tags')
        .where('tagged_type', tagged_type)
        .where('tenant', tenant!)
        .distinct('tag_text')
        .orderBy('tag_text');
      return tags.map((t):string => t.tag_text);
    } catch (error) {
      console.error(`Error getting unique tag texts for type ${tagged_type}:`, error);
      throw error;
    }
  },
};

export default Tag;
