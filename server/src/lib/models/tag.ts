// server/src/lib/models/tag.ts
import { getCurrentTenantId } from '../db';
import { ITag, TaggedEntityType } from '../../interfaces/tag.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import TagDefinition from './tagDefinition';
import TagMapping from './tagMapping';

const Tag = {
  /**
   * Get all tags (returns denormalized view from the new structure)
   */
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITag[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      // Join mappings with definitions to create ITag structure
      const tags = await knexOrTrx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id', // Use mapping_id as tag_id for backward compatibility
          'td.channel_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        );
      
      return tags;
    } catch (error) {
      console.error('Error getting all tags:', error);
      throw error;
    }
  },

  getAllByEntityId: async (knexOrTrx: Knex | Knex.Transaction, tagged_id: string, tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const tagMappings = await TagMapping.getByEntity(knexOrTrx, tagged_id, tagged_type);
      const tenant = await getCurrentTenantId() || '';
      
      // Convert to ITag format
      return tagMappings.map(tm => ({
        tag_id: tm.mapping_id, // Use mapping_id as tag_id
        tenant,
        channel_id: tm.channel_id,
        tag_text: tm.tag_text,
        tagged_id: tm.tagged_id,
        tagged_type: tm.tagged_type,
        background_color: tm.background_color,
        text_color: tm.text_color,
        created_by: tm.created_by
      }));
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
      
      // tag_id is actually mapping_id in the new system
      const tag = await knexOrTrx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', tag_id)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.channel_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first();
      
      return tag;
    } catch (error) {
      console.error(`Error getting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tag: Omit<ITag, 'tag_id' | 'tenant'>, userId?: string): Promise<Pick<ITag, "tag_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required for tag operations');
      }
      
      // Get or create tag definition
      const definition = await TagDefinition.getOrCreate(
        knexOrTrx,
        tag.tag_text,
        tag.tagged_type,
        {
          channel_id: tag.channel_id,
          background_color: tag.background_color,
          text_color: tag.text_color
        }
      );
      
      // Create mapping with user ID
      const mapping = await TagMapping.insert(knexOrTrx, {
        tag_id: definition.tag_id,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type
      }, userId);
      
      return { tag_id: mapping.mapping_id }; // Return mapping_id as tag_id for backward compatibility
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
      
      // Get the mapping to find the definition
      const mapping = await knexOrTrx('tag_mappings')
        .where('mapping_id', tag_id)
        .where('tenant', tenant)
        .first();
      
      if (!mapping) {
        throw new Error(`Tag mapping with id ${tag_id} not found`);
      }
      
      // Update the definition (only certain fields can be updated)
      await TagDefinition.update(knexOrTrx, mapping.tag_id, {
        tag_text: tag.tag_text,
        background_color: tag.background_color,
        text_color: tag.text_color,
        channel_id: tag.channel_id
      });
    } catch (error) {
      console.error(`Error updating tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tag_id: string): Promise<void> => {
    try {
      // tag_id is actually mapping_id - just delete the mapping
      await TagMapping.delete(knexOrTrx, tag_id);
    } catch (error) {
      console.error(`Error deleting tag with id ${tag_id}:`, error);
      throw error;
    }
  },

  getAllByEntityIds: async (knexOrTrx: Knex | Knex.Transaction, tagged_ids: string[], tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const tagMappings = await TagMapping.getByEntities(knexOrTrx, tagged_ids, tagged_type);
      const tenant = await getCurrentTenantId() || '';
      
      // Convert to ITag format
      return tagMappings.map(tm => ({
        tag_id: tm.mapping_id,
        tenant,
        channel_id: tm.channel_id,
        tag_text: tm.tag_text,
        tagged_id: tm.tagged_id,
        tagged_type: tm.tagged_type,
        background_color: tm.background_color,
        text_color: tm.text_color
      }));
    } catch (error) {
      console.error(`Error getting tags for multiple ${tagged_type}s:`, error);
      throw error;
    }
  },

  getAllUniqueTagsByType: async (knexOrTrx: Knex | Knex.Transaction, tagged_type: TaggedEntityType): Promise<ITag[]> => {
    try {
      const definitions = await TagDefinition.getAllByType(knexOrTrx, tagged_type);
      const tenant = await getCurrentTenantId() || '';
      
      // Convert to ITag format (use definition ID as tag_id since these are unique)
      return definitions.map(def => ({
        tag_id: def.tag_id,
        tenant,
        channel_id: def.channel_id,
        tag_text: def.tag_text,
        tagged_id: '', // No specific entity for unique tags
        tagged_type: def.tagged_type,
        background_color: def.background_color,
        text_color: def.text_color
      }));
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
      const definition = await TagDefinition.findByTextAndType(knexOrTrx, tag_text, tagged_type);
      
      if (definition) {
        await TagDefinition.update(knexOrTrx, definition.tag_id, {
          background_color,
          text_color
        });
      }
    } catch (error) {
      console.error(`Error updating color for tags with text "${tag_text}" and type "${tagged_type}":`, error);
      throw error;
    }
  },

  updateTextByText: async (knexOrTrx: Knex | Knex.Transaction, old_tag_text: string, new_tag_text: string, tagged_type: TaggedEntityType): Promise<number> => {
    try {
      const oldDefinition = await TagDefinition.findByTextAndType(knexOrTrx, old_tag_text, tagged_type);
      
      if (!oldDefinition) {
        return 0;
      }
      
      // Check if new tag text already exists
      const newDefinition = await TagDefinition.findByTextAndType(knexOrTrx, new_tag_text, tagged_type);
      
      if (newDefinition) {
        throw new Error(`Tag "${new_tag_text}" already exists for ${tagged_type} entities`);
      }
      
      // Update the definition
      await TagDefinition.update(knexOrTrx, oldDefinition.tag_id, {
        tag_text: new_tag_text
      });
      
      // Return count of affected mappings
      return await TagMapping.getUsageCount(knexOrTrx, oldDefinition.tag_id);
    } catch (error) {
      console.error(`Error updating tag text from "${old_tag_text}" to "${new_tag_text}" for type "${tagged_type}":`, error);
      throw error;
    }
  },

  deleteByText: async (knexOrTrx: Knex | Knex.Transaction, tag_text: string, tagged_type: TaggedEntityType): Promise<number> => {
    try {
      const definition = await TagDefinition.findByTextAndType(knexOrTrx, tag_text, tagged_type);
      
      if (!definition) {
        return 0;
      }
      
      // Get count before deletion
      const count = await TagMapping.getUsageCount(knexOrTrx, definition.tag_id);
      
      // Delete the definition (mappings will cascade delete)
      await TagDefinition.delete(knexOrTrx, definition.tag_id);
      
      return count;
    } catch (error) {
      console.error(`Error deleting tags with text "${tag_text}" and type "${tagged_type}":`, error);
      throw error;
    }
  }
};

export default Tag;
