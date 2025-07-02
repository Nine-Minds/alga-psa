// server/src/lib/models/tagMapping.ts
import { getCurrentTenantId } from '../db';
import { TaggedEntityType } from '../../interfaces/tag.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';

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
  channel_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
  created_by?: string | null;
}

const TagMapping = {
  /**
   * Get all tag mappings for an entity
   */
  getByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<ITagWithDefinition[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
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
          'td.channel_id',
          'td.background_color',
          'td.text_color',
          'tm.created_at',
          'tm.created_by'
        )
        .orderBy('td.tag_text', 'asc');
      
      return tags;
    } catch (error) {
      console.error(`Error getting tags for ${tagged_type} with id ${tagged_id}:`, error);
      throw error;
    }
  },

  /**
   * Get all tag mappings for multiple entities
   */
  getByEntities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tagged_ids: string[],
    tagged_type: TaggedEntityType
  ): Promise<ITagWithDefinition[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
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
          'td.channel_id',
          'td.background_color',
          'td.text_color',
          'tm.created_at',
          'tm.created_by'
        );
      
      return tags;
    } catch (error) {
      console.error(`Error getting tags for multiple ${tagged_type}s:`, error);
      throw error;
    }
  },

  /**
   * Create a new tag mapping
   */
  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    mapping: Omit<ITagMapping, 'mapping_id' | 'tenant' | 'created_at'>,
    userId?: string
  ): Promise<ITagMapping> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
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
    } catch (error) {
      console.error('Error creating tag mapping:', error);
      throw error;
    }
  },

  /**
   * Delete a tag mapping
   */
  delete: async (knexOrTrx: Knex | Knex.Transaction, mapping_id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      await knexOrTrx<ITagMapping>('tag_mappings')
        .where('mapping_id', mapping_id)
        .where('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting tag mapping with id ${mapping_id}:`, error);
      throw error;
    }
  },

  /**
   * Delete all mappings for a specific tag definition
   */
  deleteByTagId: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<number> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      const deleted = await knexOrTrx<ITagMapping>('tag_mappings')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .del();
      
      return deleted;
    } catch (error) {
      console.error(`Error deleting mappings for tag ${tag_id}:`, error);
      throw error;
    }
  },

  /**
   * Delete all mappings for an entity
   */
  deleteByEntity: async (
    knexOrTrx: Knex | Knex.Transaction,
    tagged_id: string,
    tagged_type: TaggedEntityType
  ): Promise<number> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      const deleted = await knexOrTrx<ITagMapping>('tag_mappings')
        .where('tagged_id', tagged_id)
        .where('tagged_type', tagged_type)
        .where('tenant', tenant)
        .del();
      
      return deleted;
    } catch (error) {
      console.error(`Error deleting mappings for ${tagged_type} ${tagged_id}:`, error);
      throw error;
    }
  },

  /**
   * Check if a mapping exists
   */
  exists: async (
    knexOrTrx: Knex | Knex.Transaction,
    tag_id: string,
    tagged_id: string
  ): Promise<boolean> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      const mapping = await knexOrTrx<ITagMapping>('tag_mappings')
        .where('tag_id', tag_id)
        .where('tagged_id', tagged_id)
        .where('tenant', tenant)
        .first();
      
      return !!mapping;
    } catch (error) {
      console.error('Error checking tag mapping existence:', error);
      throw error;
    }
  },

  /**
   * Get usage count for a tag
   */
  getUsageCount: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<number> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      const [{ count }] = await knexOrTrx<ITagMapping>('tag_mappings')
        .where('tag_id', tag_id)
        .where('tenant', tenant)
        .count('* as count');
      
      return parseInt(count as string);
    } catch (error) {
      console.error(`Error getting usage count for tag ${tag_id}:`, error);
      throw error;
    }
  },

  /**
   * Get all entities tagged with a specific tag
   */
  getEntitiesByTag: async (
    knexOrTrx: Knex | Knex.Transaction,
    tag_id: string,
    tagged_type?: TaggedEntityType
  ): Promise<Array<{ tagged_id: string; tagged_type: TaggedEntityType }>> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      let query = knexOrTrx<ITagMapping>('tag_mappings')
        .where('tag_id', tag_id)
        .where('tenant', tenant);
      
      if (tagged_type) {
        query = query.where('tagged_type', tagged_type);
      }
      
      const entities = await query.select('tagged_id', 'tagged_type');
      
      return entities;
    } catch (error) {
      console.error(`Error getting entities for tag ${tag_id}:`, error);
      throw error;
    }
  }
};

export default TagMapping;