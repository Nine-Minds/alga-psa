// server/src/lib/models/tagDefinition.ts
import { getCurrentTenantId } from '../db';
import { TaggedEntityType } from '../../interfaces/tag.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';

export interface ITagDefinition {
  tenant: string;
  tag_id: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  channel_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
}

const TagDefinition = {
  /**
   * Get all tag definitions for a tenant
   */
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITagDefinition[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const definitions = await knexOrTrx<ITagDefinition>('tag_definitions')
        .where('tenant', tenant)
        .orderBy('tag_text', 'asc');
      return definitions;
    } catch (error) {
      console.error('Error getting all tag definitions:', error);
      throw error;
    }
  },

  /**
   * Get tag definition by ID
   */
  get: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<ITagDefinition | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const definition = await knexOrTrx<ITagDefinition>('tag_definitions')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .first();
      return definition;
    } catch (error) {
      console.error(`Error getting tag definition with id ${tag_id}:`, error);
      throw error;
    }
  },

  /**
   * Find tag definition by text and type
   */
  findByTextAndType: async (
    knexOrTrx: Knex | Knex.Transaction, 
    tag_text: string, 
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const definition = await knexOrTrx<ITagDefinition>('tag_definitions')
        .whereRaw('LOWER(tag_text) = LOWER(?)', [tag_text.trim()])
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .first();
      return definition;
    } catch (error) {
      console.error(`Error finding tag definition for text "${tag_text}" and type "${tagged_type}":`, error);
      throw error;
    }
  },

  /**
   * Get all unique tag definitions by type
   */
  getAllByType: async (
    knexOrTrx: Knex | Knex.Transaction, 
    tagged_type: TaggedEntityType
  ): Promise<ITagDefinition[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      const definitions = await knexOrTrx<ITagDefinition>('tag_definitions')
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .orderBy('tag_text', 'asc');
      return definitions;
    } catch (error) {
      console.error(`Error getting tag definitions for type ${tagged_type}:`, error);
      throw error;
    }
  },

  /**
   * Create new tag definition
   */
  insert: async (
    knexOrTrx: Knex | Knex.Transaction, 
    definition: Omit<ITagDefinition, 'tag_id' | 'tenant' | 'created_at'>
  ): Promise<ITagDefinition> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      // Preserve case but trim whitespace
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
    } catch (error) {
      console.error('Error inserting tag definition:', error);
      throw error;
    }
  },

  /**
   * Update tag definition
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction, 
    tag_id: string, 
    updates: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tagged_type'>>
  ): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      // Normalize tag text if provided
      if (updates.tag_text) {
        updates.tag_text = updates.tag_text.toLowerCase().trim();
      }

      await knexOrTrx<ITagDefinition>('tag_definitions')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .update(updates);
    } catch (error) {
      console.error(`Error updating tag definition with id ${tag_id}:`, error);
      throw error;
    }
  },

  /**
   * Delete tag definition (mappings will be cascade deleted due to FK constraint)
   */
  delete: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      // Delete the definition (mappings will cascade delete)
      await knexOrTrx<ITagDefinition>('tag_definitions')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting tag definition with id ${tag_id}:`, error);
      throw error;
    }
  },

  /**
   * Get or create tag definition
   */
  getOrCreate: async (
    knexOrTrx: Knex | Knex.Transaction,
    tag_text: string,
    tagged_type: TaggedEntityType,
    defaults?: {
      channel_id?: string | null;
      background_color?: string | null;
      text_color?: string | null;
    }
  ): Promise<ITagDefinition> => {
    try {
      // Try to find existing
      let definition = await TagDefinition.findByTextAndType(knexOrTrx, tag_text, tagged_type);
      
      if (!definition) {
        // Create new
        definition = await TagDefinition.insert(knexOrTrx, {
          tag_text,
          tagged_type,
          ...defaults
        });
      }
      
      return definition;
    } catch (error) {
      console.error(`Error getting or creating tag definition:`, error);
      throw error;
    }
  }
};

export default TagDefinition;