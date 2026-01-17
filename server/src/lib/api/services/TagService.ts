/**
 * Tag Service
 * Service layer for tag operations with full CRUD, bulk operations,
 * analytics, search, and entity association support
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { withTransaction } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';

// Import tag models and interfaces
import TagDefinition, { ITagDefinition } from '../../models/tagDefinition';
import TagMapping, { ITagMapping, ITagWithDefinition } from '../../models/tagMapping';
import { ITag, TaggedEntityType } from '../../../interfaces/tag.interfaces';

// Import schemas for validation
import {
  CreateTagData,
  UpdateTagData,
  TagResponse,
  TagFilterParams,
  TagUsageStats,
  TagCloudData,
  EntityReference
} from '../schemas/tagSchemas';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface TagAnalyticsResult {
  total_tags: number;
  unique_tags: number;
  most_used_tags: Array<{
    tag_text: string;
    usage_count: number;
    entity_types: string[];
  }>;
  tags_by_entity_type: Record<string, number>;
  recent_tags: Array<{
    tag_text: string;
    created_at: string;
    entity_type: string;
  }>;
}

export interface BulkTagResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    entity_id: string;
    error: string;
  }>;
}

// ============================================================================
// TAG SERVICE CLASS
// ============================================================================

export class TagService extends BaseService {

  constructor() {
    super({
      tableName: 'tag_mappings',
      primaryKey: 'mapping_id',
      tenantColumn: 'tenant',
      softDelete: false,
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      },
      searchableFields: ['tag_text'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
  }

  // ========================================================================
  // TAG CRUD OPERATIONS
  // ========================================================================

  /**
   * Get tag by ID
   */
  async getTagById(id: string, context: ServiceContext): Promise<TagResponse | null> {
    const { knex, tenant } = await this.getKnex();
    
    // id is actually mapping_id in the new system
    const tag = await knex('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
            .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where('tm.mapping_id', id)
      .where('tm.tenant', tenant)
      .select(
        'tm.mapping_id as tag_id',
        'td.board_id',
        'td.tag_text',
        'tm.tagged_id',
        'tm.tagged_type',
        'td.background_color',
        'td.text_color',
        'tm.tenant',
        'tm.created_by'
      )
      .first();
    
    return tag as TagResponse | null;
  }

  /**
   * Create new tag
   */
  async createTag(
        data: CreateTagData,
        context: ServiceContext
      ): Promise<TagResponse> {
        const { knex } = await this.getKnex();
        
        return withTransaction(knex, async (trx) => {
          const tagData: Omit<ITag, 'tenant' | 'tag_id'> = {
            tag_text: data.tag_text,
            tagged_id: data.tagged_id,
            tagged_type: data.tagged_type,
            board_id: data.board_id || undefined,
            background_color: data.background_color || undefined,
            text_color: data.text_color || undefined
          };
    
          // Get or create tag definition
          const definition = await TagDefinition.getOrCreate(
            trx,
            tagData.tag_text,
            tagData.tagged_type,
            {
              board_id: tagData.board_id,
              background_color: tagData.background_color,
              text_color: tagData.text_color
            }
          );
          
          // Create mapping with user ID
          const mapping = await TagMapping.insert(trx, {
            tag_id: definition.tag_id,
            tagged_id: tagData.tagged_id,
            tagged_type: tagData.tagged_type
          }, context.userId);
          
          // Get the created tag for return
          const { tenant } = await this.getKnex();
          const created = await trx('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.mapping_id', mapping.mapping_id)
            .where('tm.tenant', tenant)
            .select(
              'tm.mapping_id as tag_id',
              'td.board_id',
              'td.tag_text',
              'tm.tagged_id',
              'tm.tagged_type',
              'td.background_color',
              'td.text_color',
              'tm.tenant',
              'tm.created_by'
            )
            .first();
    
          return created as TagResponse;
        });
      }

  /**
   * Update tag
   */
  async updateTag(
    id: string,
    data: UpdateTagData,
    context: ServiceContext
  ): Promise<TagResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const updateData = { ...data };
      if (updateData.tag_text) {
        updateData.tag_text = updateData.tag_text.toLowerCase().trim();
      }

      // Get the mapping to find the definition (id is mapping_id)
      const { tenant } = await this.getKnex();
      const mapping = await trx('tag_mappings')
        .where('mapping_id', id)
        .where('tenant', tenant)
        .first();
      
      if (!mapping) {
        throw new Error(`Tag mapping with id ${id} not found`);
      }
      
      // Update the definition (only certain fields can be updated)
      await TagDefinition.update(trx, mapping.tag_id, {
        tag_text: updateData.tag_text,
        background_color: updateData.background_color,
        text_color: updateData.text_color,
        board_id: updateData.board_id
      });
      
      // Get updated tag
      const updated = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', id)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant',
          'tm.created_by'
        )
        .first();
      
      if (!updated) {
        throw new Error('Tag not found after update');
      }

      return updated as TagResponse;
    });
  }

  /**
   * Delete tag
   */
  async deleteTag(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    // id is actually mapping_id - just delete the mapping
    await TagMapping.delete(knex, id);
  }

  /**
   * Get tags by entity
   */
  async getTagsByEntity(
    entityId: string,
    entityType: TaggedEntityType,
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();
    const tagsWithDefinitions = await TagMapping.getByEntity(knex, entityId, entityType);
    const { tenant } = await this.getKnex();
    return tagsWithDefinitions.map(tag => ({
      tag_id: tag.mapping_id,
      tenant,
      board_id: tag.board_id,
      tag_text: tag.tag_text,
      tagged_id: tag.tagged_id,
      tagged_type: tag.tagged_type,
      background_color: tag.background_color,
      text_color: tag.text_color,
      created_by: tag.created_by
    })) as TagResponse[];
  }

  /**
   * Get tags by multiple entities
   */
  async getTagsByEntities(
    entityIds: string[],
    entityType: TaggedEntityType,
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();
    const tagsWithDefinitions = await TagMapping.getByEntities(knex, entityIds, entityType);
    const { tenant } = await this.getKnex();
    return tagsWithDefinitions.map(tag => ({
      tag_id: tag.mapping_id,
      tenant,
      board_id: tag.board_id,
      tag_text: tag.tag_text,
      tagged_id: tag.tagged_id,
      tagged_type: tag.tagged_type,
      background_color: tag.background_color,
      text_color: tag.text_color,
      created_by: tag.created_by
    })) as TagResponse[];
  }

  /**
   * Get unique tags by type
   */
  async getUniqueTagsByType(
    entityType: TaggedEntityType,
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();
    const definitions = await TagDefinition.getAllByType(knex, entityType);
    const { tenant } = await this.getKnex();
    return definitions.map(def => ({
      tag_id: def.tag_id,
      tenant,
      board_id: def.board_id || undefined,
      tag_text: def.tag_text,
      tagged_id: '', // No specific entity for unique tags
      tagged_type: def.tagged_type,
      background_color: def.background_color,
      text_color: def.text_color
    })) as TagResponse[];
  }

  // ========================================================================
  // ENTITY TAGGING OPERATIONS
  // ========================================================================

  /**
   * Add tags to an entity
   */
  async tagEntity(
    entityId: string,
    entityType: TaggedEntityType,
    tagTexts: string[],
    options: {
      board_id?: string;
      default_colors?: {
        background_color?: string;
        text_color?: string;
      };
    } = {},
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const createdTags: TagResponse[] = [];

      for (const tagText of tagTexts) {
        const normalizedTag = tagText.toLowerCase().trim();
        if (!normalizedTag) continue;

        const tagData = {
          tag_text: normalizedTag,
          tagged_id: entityId,
          tagged_type: entityType,
          board_id: options.board_id || undefined,
          background_color: options.default_colors?.background_color || undefined,
          text_color: options.default_colors?.text_color || undefined
        };

        // Get or create tag definition
        const definition = await TagDefinition.getOrCreate(
          trx,
          tagData.tag_text,
          tagData.tagged_type,
          {
            board_id: tagData.board_id,
            background_color: tagData.background_color,
            text_color: tagData.text_color
          }
        );
        
        // Create mapping with user ID
        const mapping = await TagMapping.insert(trx, {
          tag_id: definition.tag_id,
          tagged_id: tagData.tagged_id,
          tagged_type: tagData.tagged_type
        }, context.userId);
        
        // Get the created tag for return
        const { tenant } = await this.getKnex();
        const created = await trx('tag_mappings as tm')
          .join('tag_definitions as td', function() {
            this.on('tm.tenant', '=', 'td.tenant')
                .andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.mapping_id', mapping.mapping_id)
          .where('tm.tenant', tenant)
          .select(
            'tm.mapping_id as tag_id',
            'td.board_id',
            'td.tag_text',
            'tm.tagged_id',
            'tm.tagged_type',
            'td.background_color',
            'td.text_color',
            'tm.tenant',
            'tm.created_by'
          )
          .first();
        
        if (created) {
          createdTags.push(created as TagResponse);
        }
      }

      return createdTags;
    });
  }

  /**
   * Remove tags from an entity
   */
  async untagEntity(
    entityId: string,
    entityType: TaggedEntityType,
    tagIds: string[],
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      for (const tagId of tagIds) {
        await TagMapping.delete(trx, tagId);
      }
    });
  }

  /**
   * Replace all tags for an entity
   */
  async replaceEntityTags(
    entityId: string,
    entityType: TaggedEntityType,
    tagTexts: string[],
    options: {
      board_id?: string;
      default_colors?: {
        background_color?: string;
        text_color?: string;
      };
    } = {},
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Get existing tags
      const existingTags = await TagMapping.getByEntity(trx, entityId, entityType);
      // Remove existing tags
      for (const tag of existingTags) {
        await TagMapping.delete(trx, tag.mapping_id); // Use mapping_id instead of tag_id
      }

      // Add new tags
      return await this.tagEntity(entityId, entityType, tagTexts, options, context);
    });
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * Bulk delete tags
   */
  async bulkDeleteTags(
    tagIds: string[],
    context: ServiceContext
  ): Promise<{ deleted: number }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      let deleted = 0;
      for (const tagId of tagIds) {
        await TagMapping.delete(trx, tagId);
        deleted++;
      }
      return { deleted };
    });
  }

  /**
   * Bulk merge tags
   */
  async bulkMergeTags(
    sourceTagIds: string[],
    targetTagText: string,
    targetColors: {
      background_color?: string;
      text_color?: string;
    } = {},
    context: ServiceContext
  ): Promise<{ merged: number; created: number }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const sourceTags: any[] = [];
      const { tenant } = await this.getKnex();
      for (const tagId of sourceTagIds) {
        const tag = await trx('tag_mappings as tm')
          .join('tag_definitions as td', function() {
            this.on('tm.tenant', '=', 'td.tenant')
                .andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.mapping_id', tagId)
          .where('tm.tenant', tenant)
          .select(
            'tm.mapping_id as tag_id',
            'td.board_id',
            'td.tag_text',
            'tm.tagged_id',
            'tm.tagged_type',
            'td.background_color',
            'td.text_color',
            'tm.tenant',
            'tm.created_by'
          )
          .first();
        if (tag) {
          sourceTags.push(tag);
        }
      }

      if (sourceTags.length === 0) {
        return { merged: 0, created: 0 };
      }

      let created = 0;
      let merged = 0;

      const entitiesByType = sourceTags.reduce((acc: any, tag: any) => {
        const key = `${tag.tagged_type}:${tag.tagged_id}`;
        if (!acc[key]) {
          acc[key] = {
            tagged_type: tag.tagged_type,
            tagged_id: tag.tagged_id,
            board_id: tag.board_id
          };
        }
        return acc;
      }, {});

      for (const entity of Object.values(entitiesByType) as any[]) {
        const tagData = {
          tag_text: targetTagText.trim(),
          tagged_id: entity.tagged_id,
          tagged_type: entity.tagged_type,
          board_id: entity.board_id,
          background_color: targetColors.background_color || undefined,
          text_color: targetColors.text_color || undefined
        };
        // Get or create tag definition
        const definition = await TagDefinition.getOrCreate(
          trx,
          tagData.tag_text,
          tagData.tagged_type,
          {
            board_id: tagData.board_id,
            background_color: tagData.background_color,
            text_color: tagData.text_color
          }
        );
        
        // Create mapping with user ID
        await TagMapping.insert(trx, {
          tag_id: definition.tag_id,
          tagged_id: tagData.tagged_id,
          tagged_type: tagData.tagged_type
        }, context.userId);
        created++;
        merged++;
      }

      for (const tagId of sourceTagIds) {
        await TagMapping.delete(trx, tagId);
      }

      return { merged, created };
    });
  }

  /**
   * Bulk untag entities
   */
  async bulkUntagEntities(
    entityIds: string[],
    entityType: TaggedEntityType,
    tagIds: string[],
    context: ServiceContext
  ): Promise<{ removed: number }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      let removed = 0;
      for (const tagId of tagIds) {
        await TagMapping.delete(trx, tagId);
        removed++;
      }
      return { removed };
    });
  }

  // ========================================================================
  // TAG MODIFICATION OPERATIONS
  // ========================================================================

  /**
   * Update tag colors for all instances of a tag
   */
  async updateTagColors(
    tagText: string,
    entityType: TaggedEntityType,
    backgroundColor: string | null,
    textColor: string | null,
    context: ServiceContext
  ): Promise<{ updated: number }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate hex color codes if provided
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (backgroundColor && !hexColorRegex.test(backgroundColor)) {
        throw new Error('Invalid background color format');
      }
      if (textColor && !hexColorRegex.test(textColor)) {
        throw new Error('Invalid text color format');
      }

      // Find the definition and update it
      const definition = await TagDefinition.findByTextAndType(trx, tagText, entityType);
      
      if (!definition) {
        return { updated: 0 };
      }

      await TagDefinition.update(trx, definition.tag_id, {
        background_color: backgroundColor,
        text_color: textColor
      });

      // Get count of affected mappings
      const updated = await TagMapping.getUsageCount(trx, definition.tag_id);

      return { updated };
    });
  }

  /**
   * Update tag text for all instances of a tag
   */
  async updateTagText(
    tagId: string,
    newTagText: string,
    context: ServiceContext
  ): Promise<{ old_tag_text: string; new_tag_text: string; tagged_type: TaggedEntityType; updated_count: number; }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate tag text
      if (!newTagText || !newTagText.trim()) {
        throw new Error('Tag text cannot be empty');
      }

      const trimmedNewText = newTagText.trim();

      // Get the original tag (tagId is actually mapping_id)
      const { tenant } = await this.getKnex();
      const tag = await trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.mapping_id', tagId)
        .where('tm.tenant', tenant)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        )
        .first();
        
      if (!tag) {
        throw new Error(`Tag with id ${tagId} not found`);
      }

      // Don't update if text is the same
      if (tag.tag_text === trimmedNewText) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }

      // Find the old definition
      const oldDefinition = await TagDefinition.findByTextAndType(trx, tag.tag_text, tag.tagged_type);
      
      if (!oldDefinition) {
        return {
          old_tag_text: tag.tag_text,
          new_tag_text: trimmedNewText,
          tagged_type: tag.tagged_type,
          updated_count: 0,
        };
      }
      
      // Check if new tag text already exists
      const newDefinition = await TagDefinition.findByTextAndType(trx, trimmedNewText, tag.tagged_type);
      
      if (newDefinition) {
        throw new Error(`Tag "${trimmedNewText}" already exists for ${tag.tagged_type} entities`);
      }
      
      // Update the definition
      await TagDefinition.update(trx, oldDefinition.tag_id, {
        tag_text: trimmedNewText
      });
      
      // Return count of affected mappings
      const updatedCount = await TagMapping.getUsageCount(trx, oldDefinition.tag_id);

      return {
        old_tag_text: tag.tag_text,
        new_tag_text: trimmedNewText,
        tagged_type: tag.tagged_type,
        updated_count: updatedCount,
      };
    });
  }

  /**
   * Delete all instances of a tag by text and type
   */
  async deleteTagsByText(
    tagText: string,
    taggedType: TaggedEntityType,
    context: ServiceContext
  ): Promise<{ deleted_count: number }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate tag text
      if (!tagText || !tagText.trim()) {
        throw new Error('Tag text cannot be empty');
      }

      const trimmedText = tagText.trim();

      // Find the definition and delete it (mappings will cascade delete)
      const definition = await TagDefinition.findByTextAndType(trx, trimmedText, taggedType);
      let deletedCount = 0;
      
      if (definition) {
        // Get count before deletion
        deletedCount = await TagMapping.getUsageCount(trx, definition.tag_id);
        
        // Delete the definition (mappings will cascade delete)
        await TagDefinition.delete(trx, definition.tag_id);
      }
      
      return {
        deleted_count: deletedCount,
      };
    });
  }

  // ========================================================================
  // SEARCH AND FILTERING
  // ========================================================================

  /**
   * Search tags with advanced filtering
   */
  async searchTags(
    searchTerm: string,
    filters: TagFilterParams = {},
    context: ServiceContext
  ): Promise<ListResult<TagResponse>> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', context.tenant);

      // Apply search
      if (searchTerm) {
        const searchPattern = `%${searchTerm.toLowerCase()}%`;
        query = query.whereRaw('LOWER(td.tag_text) LIKE ?', [searchPattern]);
      }

      // Apply filters
      if (filters.entity_type) {
        query = query.where('tm.tagged_type', filters.entity_type);
      }

      if (filters.entity_id) {
        query = query.where('tm.tagged_id', filters.entity_id);
      }

      if (filters.board_id) {
        query = query.where('td.board_id', filters.board_id);
      }

      if (filters.created_after) {
        query = query.where('tm.created_at', '>=', filters.created_after);
      }

      if (filters.created_before) {
        query = query.where('tm.created_at', '<=', filters.created_before);
      }

      // Get total count
      const countQuery = query.clone();
      const [{ count: total }] = await countQuery.count('* as count');

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      // Get results with relevance scoring
      const tags = await query.select(
        'tm.mapping_id as tag_id',
        'td.board_id',
        'td.tag_text',
        'tm.tagged_id',
        'tm.tagged_type',
        'td.background_color',
        'td.text_color',
        'tm.tenant',
        'tm.created_by',
        'tm.created_at'
      );

      // Calculate relevance and sort
      const tagsWithRelevance = tags.map(tag => ({
        ...tag,
        relevance_score: this.calculateRelevanceScore(tag, searchTerm)
      }));

      tagsWithRelevance.sort((a, b) => b.relevance_score - a.relevance_score);

      return {
        data: tagsWithRelevance as TagResponse[],
        total: parseInt(total as string),
        limit: filters.limit || total,
        offset: filters.offset || 0
      };
    });
  }

  // ========================================================================
  // ANALYTICS AND INSIGHTS
  // ========================================================================

  /**
   * Get tag analytics and usage statistics
   */
  async getTagAnalytics(
    filters: TagFilterParams = {},
    context: ServiceContext
  ): Promise<TagAnalyticsResult> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let baseQuery = trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', context.tenant);

      // Apply filters
      if (filters.entity_type) {
        baseQuery = baseQuery.where('tm.tagged_type', filters.entity_type);
      }

      if (filters.created_after) {
        baseQuery = baseQuery.where('tm.created_at', '>=', filters.created_after);
      }

      if (filters.created_before) {
        baseQuery = baseQuery.where('tm.created_at', '<=', filters.created_before);
      }

      // Get basic stats
      const totalTags = await baseQuery.clone().count('* as count').first();
      const uniqueTags = await baseQuery.clone().countDistinct('td.tag_text as count').first();

      // Get most used tags
      const mostUsedTags = await baseQuery.clone()
        .select('td.tag_text')
        .count('* as usage_count')
        .groupBy('td.tag_text')
        .orderBy('usage_count', 'desc')
        .limit(10);

      // Add entity types for each tag
      const mostUsedTagsWithTypes = await Promise.all(
        mostUsedTags.map(async (tag: any) => {
          const entityTypes = await trx('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tenant', context.tenant)
            .where('td.tag_text', tag.tag_text)
            .distinct('tm.tagged_type')
            .pluck('tm.tagged_type');

          return {
            tag_text: tag.tag_text,
            usage_count: parseInt(tag.usage_count),
            entity_types: entityTypes
          };
        })
      );

      // Get tags by entity type
      const tagsByEntityType = await baseQuery.clone()
        .select('tm.tagged_type')
        .count('* as count')
        .groupBy('tm.tagged_type');

      const tagsByEntityTypeMap = tagsByEntityType.reduce((acc: any, item: any) => {
        acc[item.tagged_type] = parseInt(item.count);
        return acc;
      }, {});

      // Get recent tags
      const recentTags = await baseQuery.clone()
        .select('td.tag_text', 'tm.created_at', 'tm.tagged_type as entity_type')
        .orderBy('tm.created_at', 'desc')
        .limit(20);

      return {
        total_tags: parseInt(totalTags?.count as string || '0'),
        unique_tags: parseInt(uniqueTags?.count as string || '0'),
        most_used_tags: mostUsedTagsWithTypes,
        tags_by_entity_type: tagsByEntityTypeMap,
        recent_tags: recentTags.map((tag: any) => ({
          tag_text: tag.tag_text,
          created_at: tag.created_at,
          entity_type: tag.entity_type
        }))
      };
    });
  }

  /**
   * Generate tag cloud data
   */
  async getTagCloudData(
    entityType: TaggedEntityType | null = null,
    limit: number = 50,
    context: ServiceContext
  ): Promise<TagCloudData[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = trx('tag_mappings as tm')
        .join('tag_definitions as td', function() {
          this.on('tm.tenant', '=', 'td.tenant')
              .andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', context.tenant);

      if (entityType) {
        query = query.where('tm.tagged_type', entityType);
      }

      const tags = await query
        .select('td.tag_text', 'td.background_color', 'td.text_color')
        .count('* as usage_count')
        .groupBy('td.tag_text', 'td.background_color', 'td.text_color')
        .orderBy('usage_count', 'desc')
        .limit(limit);

      // Calculate relative weights
      const maxUsage = Math.max(...tags.map((tag: any) => parseInt(tag.usage_count)));
      const minUsage = Math.min(...tags.map((tag: any) => parseInt(tag.usage_count)));

      return tags.map((tag: any) => ({
        tag_text: tag.tag_text,
        usage_count: parseInt(tag.usage_count),
        weight: maxUsage > minUsage 
          ? (parseInt(tag.usage_count) - minUsage) / (maxUsage - minUsage)
          : 1,
        background_color: tag.background_color,
        text_color: tag.text_color
      }));
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(tag: any, searchTerm: string): number {
    if (!searchTerm) return 0;

    const term = searchTerm.toLowerCase();
    const tagText = (tag.tag_text || '').toLowerCase();

    let score = 0;

    // Exact match gets highest score
    if (tagText === term) {
      score += 100;
    }
    // Starts with search term
    else if (tagText.startsWith(term)) {
      score += 75;
    }
    // Contains search term
    else if (tagText.includes(term)) {
      score += 50;
    }

    return score;
  }
}

export default TagService;
