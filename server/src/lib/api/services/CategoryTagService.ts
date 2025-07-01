/**
 * Category & Tag Service
 * Comprehensive service layer for category and tag operations with full CRUD,
 * hierarchical management, analytics, and entity association support
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { withTransaction } from '@shared/db';
import { v4 as uuidv4 } from 'uuid';

// Import existing models and interfaces
import Tag from '../../models/tag';
import TicketCategory from '../../models/ticketCategory';
import { ITag, TaggedEntityType } from '../../../interfaces/tag.interfaces';
import { ITicketCategory } from '../../../interfaces/ticket.interfaces';
import { IServiceCategory } from '../../../interfaces/billing.interfaces';

// Import schemas for validation
import {
  CreateServiceCategoryData,
  CreateTicketCategoryData,
  ServiceCategoryResponse,
  TicketCategoryResponse,
  CreateTagData,
  UpdateTagData,
  TagResponse,
  TaggedEntityType as SchemaTaggedEntityType,
  CategoryType,
  TagFilterParams,
  CategoryFilterParams,
  TagUsageStats,
  CategoryUsageStats,
  TagCloudData,
  EntityReference
} from '../schemas/categoryTagSchemas';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface CategoryTreeNode {
  category_id: string;
  category_name: string;
  parent_category: string | null;
  children: CategoryTreeNode[];
  depth: number;
  path: string;
  order?: number;
  usage_count?: number;
}

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

export interface CategoryAnalyticsResult {
  total_categories: number;
  categories_by_type: Record<string, number>;
  most_used_categories: Array<{
    category_id: string;
    category_name: string;
    usage_count: number;
    category_type: string;
  }>;
  hierarchy_depth_stats: Record<number, number>;
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

export interface BulkCategoryResult {
  created: number;
  updated: number;
  deleted: number;
  errors: Array<{
    category_id?: string;
    error: string;
  }>;
}

// ============================================================================
// CATEGORY TAG SERVICE CLASS
// ============================================================================

export class CategoryTagService extends BaseService {
  constructor() {
    super({
      tableName: 'tags', // Primary table (can be overridden per operation)
      primaryKey: 'tag_id',
      tenantColumn: 'tenant',
      searchableFields: ['tag_text'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
  }

  // ========================================================================
  // SERVICE CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List service categories with filtering and pagination
   */
  async listServiceCategories(
      filters: Partial<CategoryFilterParams> = {},
      context: ServiceContext,
      options: { page?: number; limit?: number } = {}
    ): Promise<ListResult<ServiceCategoryResponse>> {
      const { knex } = await this.getKnex();
      
      const query = knex('service_categories')
        .where('tenant', context.tenant);
  
      // Apply filters
      if (filters.category_name) {
        query.whereILike('category_name', `%${filters.category_name}%`);
      }
      // has_description filter removed - not available in filter type
  
      // Get total count
      const [{ count }] = await query.clone().count('* as count');
  
      // Apply pagination and get data
      const limit = options.limit || 25;
      const page = options.page || 1;
      const offset = (page - 1) * limit;
  
      const categories = await query
        .select('category_id', 'category_name', 'description', 'tenant')
        .orderBy('category_name', 'asc')
        .limit(limit)
        .offset(offset);
  
      return {
        data: categories as ServiceCategoryResponse[],
        total: parseInt(count as string)
      };
    }


  /**
   * Get service category by ID
   */
  async getServiceCategoryById(
    id: string,
    context: ServiceContext
  ): Promise<ServiceCategoryResponse | null> {
    const { knex } = await this.getKnex();

    const category = await knex('service_categories')
      .where({ category_id: id, tenant: context.tenant })
      .select('category_id', 'category_name', 'description', 'tenant')
      .first();

    return category as ServiceCategoryResponse | null;
  }

  /**
   * Create new service category
   */
  async createServiceCategory(
    data: CreateServiceCategoryData,
    context: ServiceContext
  ): Promise<ServiceCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check for duplicate name
      const existing = await trx('service_categories')
        .where({
          tenant: context.tenant,
          category_name: data.category_name
        })
        .first();

      if (existing) {
        throw new Error(`Service category '${data.category_name}' already exists`);
      }

      const categoryData = {
        category_id: uuidv4(),
        category_name: data.category_name,
        description: data.description || null,
        tenant: context.tenant
      };

      const [category] = await trx('service_categories')
        .insert(categoryData)
        .returning('*');

      return category as ServiceCategoryResponse;
    });
  }

  /**
   * Update service category
   */
  async updateServiceCategory(
    id: string,
    data: Partial<CreateServiceCategoryData>,
    context: ServiceContext
  ): Promise<ServiceCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check if category exists
      const existing = await trx('service_categories')
        .where({ category_id: id, tenant: context.tenant })
        .first();

      if (!existing) {
        throw new Error('Service category not found');
      }

      // Check for duplicate name if changing name
      if (data.category_name && data.category_name !== existing.category_name) {
        const duplicate = await trx('service_categories')
          .where({
            tenant: context.tenant,
            category_name: data.category_name
          })
          .whereNot('category_id', id)
          .first();

        if (duplicate) {
          throw new Error(`Service category '${data.category_name}' already exists`);
        }
      }

      const [updated] = await trx('service_categories')
        .where({ category_id: id, tenant: context.tenant })
        .update(data)
        .returning('*');

      return updated as ServiceCategoryResponse;
    });
  }

  /**
   * Delete service category
   */
  async deleteServiceCategory(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check if category is in use
      const inUse = await trx('services')
        .where({ service_category: id, tenant: context.tenant })
        .first();

      if (inUse) {
        throw new Error('Cannot delete service category that is in use');
      }

      const deleted = await trx('service_categories')
        .where({ category_id: id, tenant: context.tenant })
        .delete();

      if (deleted === 0) {
        throw new Error('Service category not found');
      }
    });
  }

  // ========================================================================
  // TICKET CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List ticket categories with hierarchical support
   */
  async listTicketCategories(
      filters: Partial<CategoryFilterParams> = {},
      context: ServiceContext,
      options: { page?: number; limit?: number } = {}
    ): Promise<ListResult<TicketCategoryResponse>> {
      const { knex } = await this.getKnex();
      
      const query = knex('ticket_categories as tc')
        .leftJoin('ticket_categories as parent', 'tc.parent_category', 'parent.category_id')
        .leftJoin('channels as ch', 'tc.channel_id', 'ch.channel_id')
        .where('tc.tenant', context.tenant);
  
      // Apply filters
      if (filters.category_name) {
        query.whereILike('tc.category_name', `%${filters.category_name}%`);
      }
      if (filters.channel_id) {
        query.where('tc.channel_id', filters.channel_id);
      }
      if (filters.parent_category) {
        query.where('tc.parent_category', filters.parent_category);
      }
      if (filters.is_parent !== undefined) {
        if (filters.is_parent) {
          query.whereNotNull('tc.parent_category');
        } else {
          query.whereNull('tc.parent_category');
        }
      }
  
      // Get total count
      const [{ count }] = await query.clone().count('tc.category_id as count');
  
      // Apply pagination and get data
      const limit = options.limit || 25;
      const page = options.page || 1;
      const offset = (page - 1) * limit;
  
      const categories = await query
        .select(
          'tc.category_id',
          'tc.category_name',
          'tc.parent_category',
          'tc.channel_id',
          'tc.description',
          'tc.created_by',
          'tc.created_at',
          'tc.tenant',
          'parent.category_name as parent_category_name',
          'ch.channel_name'
        )
        .orderBy('tc.category_name', 'asc')
        .limit(limit)
        .offset(offset);
  
      return {
        data: categories as TicketCategoryResponse[],
        total: parseInt(count as string)
      };
    }


  /**
   * Get ticket category by ID with hierarchy information
   */
  async getTicketCategoryById(
    id: string,
    context: ServiceContext
  ): Promise<TicketCategoryResponse | null> {
    const category = await TicketCategory.get(await this.getKnex().then(k => k.knex), id);
    
    if (!category) {
      return null;
    }

    const enriched = await this.enrichCategoriesWithHierarchy([category], context);
    return enriched[0] || null;
  }

  /**
   * Create new ticket category
   */
  async createTicketCategory(
      data: CreateTicketCategoryData,
      context: ServiceContext
    ): Promise<TicketCategoryResponse> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Validate parent category exists if provided
        if (data.parent_category) {
          const parentExists = await trx('ticket_categories')
            .where('category_id', data.parent_category)
            .where('tenant', context.tenant)
            .first();
          
          if (!parentExists) {
            throw new Error('Parent category not found');
          }
        }
  
        // Validate channel exists
        const channelExists = await trx('channels')
          .where('channel_id', data.channel_id)
          .where('tenant', context.tenant)
          .first();
        
        if (!channelExists) {
          throw new Error('Channel not found');
        }
  
        const categoryId = uuidv4();
        const categoryData = {
          category_id: categoryId,
          category_name: data.category_name,
          parent_category: data.parent_category || null,
          channel_id: data.channel_id,
          description: data.description || null,
          created_by: context.userId,
          created_at: new Date(),
          tenant: context.tenant
        };
  
        await trx('ticket_categories').insert(categoryData);
  
        // Return the created category
        const created = await trx('ticket_categories as tc')
          .leftJoin('ticket_categories as parent', 'tc.parent_category', 'parent.category_id')
          .leftJoin('channels as ch', 'tc.channel_id', 'ch.channel_id')
          .where('tc.category_id', categoryId)
          .where('tc.tenant', context.tenant)
          .select(
            'tc.category_id',
            'tc.category_name',
            'tc.parent_category',
            'tc.channel_id',
            'tc.description',
            'tc.created_by',
            'tc.created_at',
            'tc.tenant',
            'parent.category_name as parent_category_name',
            'ch.channel_name'
          )
          .first();
  
        return created as TicketCategoryResponse;
      });
    }


  /**
   * Update ticket category
   */
  async updateTicketCategory(
      categoryId: string,
      data: Partial<CreateTicketCategoryData>,
      context: ServiceContext
    ): Promise<TicketCategoryResponse> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Check if category exists
        const existing = await trx('ticket_categories')
          .where('category_id', categoryId)
          .where('tenant', context.tenant)
          .first();
        
        if (!existing) {
          throw new Error('Ticket category not found');
        }
  
        // Validate parent category if being updated
        if (data.parent_category !== undefined) {
          if (data.parent_category && data.parent_category !== categoryId) {
            const parentExists = await trx('ticket_categories')
              .where('category_id', data.parent_category)
              .where('tenant', context.tenant)
              .first();
            
            if (!parentExists) {
              throw new Error('Parent category not found');
            }
          }
        }
  
        // Prepare update data, converting undefined to null where needed
        const updateData: any = {};
        if (data.category_name !== undefined) updateData.category_name = data.category_name;
        if (data.parent_category !== undefined) updateData.parent_category = data.parent_category || null;
        if (data.channel_id !== undefined) updateData.channel_id = data.channel_id;
        if (data.description !== undefined) updateData.description = data.description || null;
  
        await trx('ticket_categories')
          .where('category_id', categoryId)
          .where('tenant', context.tenant)
          .update(updateData);
  
        // Return updated category
        const updated = await trx('ticket_categories as tc')
          .leftJoin('ticket_categories as parent', 'tc.parent_category', 'parent.category_id')
          .leftJoin('channels as ch', 'tc.channel_id', 'ch.channel_id')
          .where('tc.category_id', categoryId)
          .where('tc.tenant', context.tenant)
          .select(
            'tc.category_id',
            'tc.category_name',
            'tc.parent_category',
            'tc.channel_id',
            'tc.description',
            'tc.created_by',
            'tc.created_at',
            'tc.tenant',
            'parent.category_name as parent_category_name',
            'ch.channel_name'
          )
          .first();
  
        return updated as TicketCategoryResponse;
      });
    }


  /**
   * Delete ticket category
   */
  async deleteTicketCategory(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    await TicketCategory.delete(knex, id);
  }

  /**
   * Get category tree for a channel
   */
  async getCategoryTree(
    channelId: string,
    context: ServiceContext
  ): Promise<CategoryTreeNode[]> {
    const { knex } = await this.getKnex();

    // Get all categories for the channel
    const categories = await knex('categories')
      .where({
        channel_id: channelId,
        tenant: context.tenant
      })
      .orderBy('category_name', 'asc');

    // Build tree structure
    return this.buildCategoryTree(categories);
  }

  /**
   * Move category to new parent
   */
  async moveCategory(
    categoryId: string,
    newParentId: string | null,
    context: ServiceContext
  ): Promise<TicketCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate new parent if provided
      if (newParentId) {
        const parent = await trx('categories')
          .where({
            category_id: newParentId,
            tenant: context.tenant
          })
          .first();

        if (!parent) {
          throw new Error('New parent category not found');
        }

        // Check for circular hierarchy
        const isCircular = await this.checkCircularHierarchy(
          newParentId,
          categoryId,
          context,
          trx
        );

        if (isCircular) {
          throw new Error('Cannot create circular category hierarchy');
        }
      }

      const updated = await TicketCategory.update(trx, categoryId, {
        parent_category: newParentId || undefined
      });

      const enriched = await this.enrichCategoriesWithHierarchy([updated], context);
      return enriched[0];
    });
  }

  // ========================================================================
  // TAG OPERATIONS
  // ========================================================================

  /**
   * List tags with filtering and analytics
   */
  async listTags(
      filters: TagFilterParams = {},
      context: ServiceContext,
      options: { page?: number; limit?: number } = {}
    ): Promise<ListResult<TagResponse>> {
      const { knex } = await this.getKnex();
      
      const query = knex('tags as t')
        .leftJoin('channels as ch', 't.channel_id', 'ch.channel_id')
        .where('t.tenant', context.tenant);
  
      // Apply filters
      if (filters.tag_text) {
        query.whereILike('t.tag_text', `%${filters.tag_text}%`);
      }
      if (filters.tagged_type) {
        if (Array.isArray(filters.tagged_type)) {
          query.whereIn('t.tagged_type', filters.tagged_type);
        } else {
          query.where('t.tagged_type', filters.tagged_type);
        }
      }
      if (filters.tagged_id) {
        query.where('t.tagged_id', filters.tagged_id);
      }
      if (filters.channel_id) {
        query.where('t.channel_id', filters.channel_id);
      }
      if (filters.background_color) {
        query.where('t.background_color', filters.background_color);
      }
      if (filters.is_active !== undefined) {
        query.where('t.is_active', filters.is_active);
      }
  
      // Get total count
      const [{ count }] = await query.clone().count('t.tag_id as count');
  
      // Apply pagination and get data
      const limit = options.limit || 25;
      const page = options.page || 1;
      const offset = (page - 1) * limit;
  
      const tags = await query
        .select(
          't.*',
          'ch.channel_name'
        )
        .orderBy('t.tag_text', 'asc')
        .limit(limit)
        .offset(offset);
  
      return {
        data: tags as TagResponse[],
        total: parseInt(count as string)
      };
    }


  /**
   * Get tag by ID
   */
  async getTagById(id: string, context: ServiceContext): Promise<TagResponse | null> {
    const { knex } = await this.getKnex();
    return await Tag.get(knex, id) as TagResponse | null;
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
            channel_id: data.channel_id || undefined,
            background_color: data.background_color || undefined,
            text_color: data.text_color || undefined
          };
    
          const fullTagData = {
            tag_id: uuidv4(),
            ...tagData,
            // Convert undefined to null for database
            channel_id: tagData.channel_id || null,
            background_color: tagData.background_color || null,
            text_color: tagData.text_color || null,
            tenant: context.tenant,
            created_at: new Date()
          };
    
          await trx('tags').insert(fullTagData);
    
          // Return the created tag with channel info
          const created = await trx('tags as t')
            .leftJoin('channels as ch', 't.channel_id', 'ch.channel_id')
            .where('t.tag_id', fullTagData.tag_id)
            .where('t.tenant', context.tenant)
            .select('t.*', 'ch.channel_name')
            .first();
    
          // Transform null back to undefined for response
          const response = {
            ...created,
            channel_id: created.channel_id || undefined,
            background_color: created.background_color || undefined,
            text_color: created.text_color || undefined
          };
    
          return response as TagResponse;
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

      await Tag.update(trx, id, updateData);
      const updated = await Tag.get(trx, id);
      
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
    await Tag.delete(knex, id);
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
    return await Tag.getAllByEntityId(knex, entityId, entityType) as TagResponse[];
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
    return await Tag.getAllByEntityIds(knex, entityIds, entityType) as TagResponse[];
  }

  /**
   * Get unique tags by type
   */
  async getUniqueTagsByType(
    entityType: TaggedEntityType,
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();
    return await Tag.getAllUniqueTagsByType(knex, entityType) as TagResponse[];
  }

  // ========================================================================
  // ENTITY TAGGING OPERATIONS
  // ========================================================================

  /**
   * Tag an entity with multiple tags
   */
  async tagEntity(
    entityId: string,
    entityType: TaggedEntityType,
    tagTexts: string[],
    options: {
      channel_id?: string;
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
        
        // Check if tag already exists for this entity
        const existingTag = await trx('tags')
          .where({
            tag_text: normalizedTag,
            tagged_id: entityId,
            tagged_type: entityType,
            tenant: context.tenant
          })
          .first();

        if (!existingTag) {
          // Get colors from existing tag with same text if available
          let colors = options.default_colors || {};
          
          const existingTagWithColors = await trx('tags')
            .where({
              tag_text: normalizedTag,
              tagged_type: entityType,
              tenant: context.tenant
            })
            .whereNotNull('background_color')
            .orWhereNotNull('text_color')
            .first();

          if (existingTagWithColors) {
            colors = {
              background_color: existingTagWithColors.background_color,
              text_color: existingTagWithColors.text_color
            };
          }

          const tagData = {
            tag_text: normalizedTag,
            tagged_id: entityId,
            tagged_type: entityType,
            channel_id: options.channel_id || undefined,
            background_color: colors.background_color || undefined,
            text_color: colors.text_color || undefined
          };

          const result = await Tag.insert(trx, tagData);
          createdTags.push({
            ...tagData,
            tag_id: result.tag_id,
            tenant: context.tenant
          } as TagResponse);
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
      await trx('tags')
        .whereIn('tag_id', tagIds)
        .where({
          tagged_id: entityId,
          tagged_type: entityType,
          tenant: context.tenant
        })
        .delete();
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
      channel_id?: string;
      default_colors?: {
        background_color?: string;
        text_color?: string;
      };
    } = {},
    context: ServiceContext
  ): Promise<TagResponse[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Remove existing tags
      await trx('tags')
        .where({
          tagged_id: entityId,
          tagged_type: entityType,
          tenant: context.tenant
        })
        .delete();

      // Add new tags
      return await this.tagEntity(entityId, entityType, tagTexts, options, context);
    });
  }

  /**
   * Bulk tag multiple entities
   */
  async bulkTagEntities(
    entities: Array<{ entity_id: string; entity_type: TaggedEntityType }>,
    tagTexts: string[],
    options: {
      channel_id?: string;
      default_colors?: {
        background_color?: string;
        text_color?: string;
      };
    } = {},
    context: ServiceContext
  ): Promise<BulkTagResult> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const result: BulkTagResult = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
      };

      for (const entity of entities) {
        try {
          const tags = await this.tagEntity(
            entity.entity_id,
            entity.entity_type,
            tagTexts,
            options,
            context
          );
          result.created += tags.length;
        } catch (error) {
          result.errors.push({
            entity_id: entity.entity_id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return result;
    });
  }

  /**
   * Bulk remove tags from multiple entities
   */
  async bulkUntagEntities(
    entities: Array<{ entity_id: string; entity_type: TaggedEntityType }>,
    tagIds: string[],
    context: ServiceContext
  ): Promise<{ removed: number; errors: Array<{ entity_id: string; error: string }> }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const result = {
        removed: 0,
        errors: [] as Array<{ entity_id: string; error: string }>
      };

      for (const entity of entities) {
        try {
          const removed = await trx('tags')
            .whereIn('tag_id', tagIds)
            .where({
              tagged_id: entity.entity_id,
              tagged_type: entity.entity_type,
              tenant: context.tenant
            })
            .delete();

          result.removed += removed;
        } catch (error) {
          result.errors.push({
            entity_id: entity.entity_id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return result;
    });
  }

  // ========================================================================
  // TAG COLOR OPERATIONS
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
      // Validate hex colors if provided
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (backgroundColor && !hexColorRegex.test(backgroundColor)) {
        throw new Error('Invalid background color format');
      }
      if (textColor && !hexColorRegex.test(textColor)) {
        throw new Error('Invalid text color format');
      }

      await Tag.updateColorByText(trx, tagText, entityType, backgroundColor, textColor);

      const updated = await trx('tags')
        .where({
          tag_text: tagText,
          tagged_type: entityType,
          tenant: context.tenant
        })
        .count('* as count')
        .first();

      return { updated: parseInt(updated?.count as string || '0') };
    });
  }

  /**
   * Update tag text for all instances of a tag
   */
  async updateTagText(
    tagId: string,
    newTagText: string,
    context: ServiceContext
  ): Promise<{ 
    old_tag_text: string; 
    new_tag_text: string; 
    tagged_type: TaggedEntityType; 
    updated_count: number; 
  }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate tag text
      if (!newTagText || !newTagText.trim()) {
        throw new Error('Tag text cannot be empty');
      }

      const trimmedNewText = newTagText.trim();

      // Get the original tag
      const tag = await Tag.get(trx, tagId);
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

      // Update all tags with the same text and type
      const updatedCount = await Tag.updateTextByText(
        trx, 
        tag.tag_text, 
        trimmedNewText, 
        tag.tagged_type
      );

      return {
        old_tag_text: tag.tag_text,
        new_tag_text: trimmedNewText,
        tagged_type: tag.tagged_type,
        updated_count: updatedCount,
      };
    });
  }

  /**
   * Delete all tags with specific text and type
   */
  async deleteTagsByText(
    tagText: string,
    taggedType: TaggedEntityType,
    context: ServiceContext
  ): Promise<{ 
    deleted_count: number; 
  }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate tag text
      if (!tagText || !tagText.trim()) {
        throw new Error('Tag text cannot be empty');
      }

      const trimmedText = tagText.trim();

      // Delete all tags with the specified text and type
      const deletedCount = await Tag.deleteByText(
        trx, 
        trimmedText, 
        taggedType
      );

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
    query: string,
    options: {
      entity_types?: TaggedEntityType[];
      channel_ids?: string[];
      exact_match?: boolean;
      include_colors?: boolean;
      limit?: number;
    } = {},
    context: ServiceContext
  ): Promise<Array<TagResponse & { usage_count: number; relevance_score?: number }>> {
    const { knex } = await this.getKnex();

    let sqlQuery = knex('tags')
      .where('tenant', context.tenant);

    // Apply search logic
    if (options.exact_match) {
      sqlQuery = sqlQuery.where('tag_text', query.toLowerCase().trim());
    } else {
      sqlQuery = sqlQuery.whereILike('tag_text', `%${query.toLowerCase().trim()}%`);
    }

    // Apply filters
    if (options.entity_types && options.entity_types.length > 0) {
      sqlQuery = sqlQuery.whereIn('tagged_type', options.entity_types);
    }
    if (options.channel_ids && options.channel_ids.length > 0) {
      sqlQuery = sqlQuery.whereIn('channel_id', options.channel_ids);
    }

    // Get usage counts and relevance scoring
    const results = await sqlQuery
      .select(
        'tag_text',
        'tagged_type',
        'background_color',
        'text_color',
        knex.raw('COUNT(*) as usage_count'),
        knex.raw('MIN(tag_id) as tag_id') // Get one representative tag_id
      )
      .groupBy('tag_text', 'tagged_type', 'background_color', 'text_color')
      .orderBy('usage_count', 'desc')
      .limit(options.limit || 25);

    // Calculate relevance score for non-exact matches
    if (!options.exact_match) {
      const searchLower = query.toLowerCase();
      results.forEach((result: any) => {
        const tagLower = result.tag_text.toLowerCase();
        if (tagLower.startsWith(searchLower)) {
          result.relevance_score = 1.0;
        } else if (tagLower.includes(searchLower)) {
          result.relevance_score = 0.7;
        } else {
          result.relevance_score = 0.5;
        }
      });

      // Sort by relevance then usage
      results.sort((a: any, b: any) => {
        if (a.relevance_score !== b.relevance_score) {
          return b.relevance_score - a.relevance_score;
        }
        return b.usage_count - a.usage_count;
      });
    }

    return results.map(result => ({
      tag_id: result.tag_id,
      tag_text: result.tag_text,
      tagged_id: '', // Not applicable for search results
      tagged_type: result.tagged_type,
      channel_id: null,
      background_color: result.background_color,
      text_color: result.text_color,
      tenant: context.tenant,
      usage_count: parseInt(result.usage_count),
      relevance_score: result.relevance_score
    }));
  }

  /**
   * Search categories
   */
  async searchCategories(
    query: string,
    options: {
      category_type?: 'service' | 'ticket';
      channel_id?: string;
      include_path?: boolean;
      include_usage?: boolean;
      limit?: number;
    } = {},
    context: ServiceContext
  ): Promise<Array<{
    category_id: string;
    category_name: string;
    category_type: 'service' | 'ticket';
    path?: string;
    usage_count?: number;
    parent_category: string | null;
    relevance_score?: number;
  }>> {
    const { knex } = await this.getKnex();

    const results: any[] = [];

    // Search service categories if not restricted to tickets
    if (!options.category_type || options.category_type === 'service') {
      const serviceCategories = await knex('service_categories')
        .where('tenant', context.tenant)
        .whereILike('category_name', `%${query}%`)
        .select('category_id', 'category_name')
        .limit(options.limit || 25);

      results.push(...serviceCategories.map((cat: any) => ({
        ...cat,
        category_type: 'service' as const,
        parent_category: null,
        relevance_score: this.calculateRelevanceScore(query, cat.category_name)
      })));
    }

    // Search ticket categories if not restricted to services
    if (!options.category_type || options.category_type === 'ticket') {
      let ticketQuery = knex('categories')
        .where('tenant', context.tenant)
        .whereILike('category_name', `%${query}%`);

      if (options.channel_id) {
        ticketQuery = ticketQuery.where('channel_id', options.channel_id);
      }

      const ticketCategories = await ticketQuery
        .select('category_id', 'category_name', 'parent_category')
        .limit(options.limit || 25);

      results.push(...ticketCategories.map((cat: any) => ({
        ...cat,
        category_type: 'ticket' as const,
        relevance_score: this.calculateRelevanceScore(query, cat.category_name)
      })));
    }

    // Sort by relevance
    results.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    return results.slice(0, options.limit || 25);
  }

  // ========================================================================
  // ANALYTICS AND STATISTICS
  // ========================================================================

  /**
   * Get tag usage statistics
   */
  async getTagAnalytics(
    options: {
      entity_type?: TaggedEntityType;
      channel_id?: string;
      date_from?: string;
      date_to?: string;
      limit?: number;
    } = {},
    context: ServiceContext
  ): Promise<TagAnalyticsResult> {
    const { knex } = await this.getKnex();

    let baseQuery = knex('tags')
      .where('tenant', context.tenant);

    // Apply filters
    if (options.entity_type) {
      baseQuery = baseQuery.where('tagged_type', options.entity_type);
    }
    if (options.channel_id) {
      baseQuery = baseQuery.where('channel_id', options.channel_id);
    }

    const [
      totalStats,
      mostUsedTags,
      tagsByEntityType,
      recentTags
    ] = await Promise.all([
      // Total and unique tag counts
      baseQuery.clone()
        .select(
          knex.raw('COUNT(*) as total_tags'),
          knex.raw('COUNT(DISTINCT tag_text) as unique_tags')
        )
        .first(),

      // Most used tags
      baseQuery.clone()
        .select(
          'tag_text',
          knex.raw('COUNT(*) as usage_count'),
          knex.raw('ARRAY_AGG(DISTINCT tagged_type) as entity_types')
        )
        .groupBy('tag_text')
        .orderBy('usage_count', 'desc')
        .limit(options.limit || 10),

      // Tags by entity type
      baseQuery.clone()
        .select(
          'tagged_type',
          knex.raw('COUNT(*) as count')
        )
        .groupBy('tagged_type'),

      // Recent tags
      baseQuery.clone()
        .select('tag_text', 'tagged_type')
        .orderBy('tag_id', 'desc') // Assuming tag_id is chronological
        .limit(options.limit || 10)
    ]);

    return {
      total_tags: parseInt(totalStats?.total_tags || '0'),
      unique_tags: parseInt(totalStats?.unique_tags || '0'),
      most_used_tags: mostUsedTags.map((tag: any) => ({
        tag_text: tag.tag_text,
        usage_count: parseInt(tag.usage_count),
        entity_types: Array.isArray(tag.entity_types) ? tag.entity_types : [tag.entity_types]
      })),
      tags_by_entity_type: tagsByEntityType.reduce((acc: Record<string, number>, row: any) => {
        acc[row.tagged_type] = parseInt(row.count);
        return acc;
      }, {}),
      recent_tags: recentTags.map((tag: any) => ({
        tag_text: tag.tag_text,
        created_at: tag.created_at || new Date().toISOString(),
        entity_type: tag.tagged_type
      }))
    };
  }

  /**
   * Get category usage statistics
   */
  async getCategoryAnalytics(
    options: {
      category_type?: 'service' | 'ticket';
      channel_id?: string;
      date_from?: string;
      date_to?: string;
      include_subcategories?: boolean;
    } = {},
    context: ServiceContext
  ): Promise<CategoryAnalyticsResult> {
    const { knex } = await this.getKnex();

    const [
      serviceStats,
      ticketStats,
      serviceUsage,
      ticketUsage,
      hierarchyStats
    ] = await Promise.all([
      // Service category counts
      (!options.category_type || options.category_type === 'service') ?
        knex('service_categories')
          .where('tenant', context.tenant)
          .count('* as count')
          .first() : 
        Promise.resolve({ count: '0' }),

      // Ticket category counts
      (!options.category_type || options.category_type === 'ticket') ?
        knex('categories')
          .where('tenant', context.tenant)
          .where(options.channel_id ? { channel_id: options.channel_id } : {})
          .count('* as count')
          .first() :
        Promise.resolve({ count: '0' }),

      // Service category usage
      (!options.category_type || options.category_type === 'service') ?
        knex('services as s')
          .leftJoin('service_categories as sc', 's.service_category', 'sc.category_id')
          .where('s.tenant', context.tenant)
          .whereNotNull('s.service_category')
          .select(
            'sc.category_id',
            'sc.category_name',
            knex.raw('COUNT(s.service_id) as usage_count')
          )
          .groupBy('sc.category_id', 'sc.category_name')
          .orderBy('usage_count', 'desc')
          .limit(10) :
        Promise.resolve([]),

      // Ticket category usage
      (!options.category_type || options.category_type === 'ticket') ?
        knex('tickets as t')
          .leftJoin('categories as c', function() {
            this.on('t.category_id', '=', 'c.category_id')
                .orOn('t.subcategory_id', '=', 'c.category_id');
          })
          .where('t.tenant', context.tenant)
          .whereNotNull('c.category_id')
          .select(
            'c.category_id',
            'c.category_name',
            knex.raw('COUNT(t.ticket_id) as usage_count')
          )
          .groupBy('c.category_id', 'c.category_name')
          .orderBy('usage_count', 'desc')
          .limit(10) :
        Promise.resolve([]),

      // Hierarchy depth statistics (ticket categories only)
      (!options.category_type || options.category_type === 'ticket') ?
        this.getCategoryHierarchyStats(context) :
        Promise.resolve({})
    ]);

    const mostUsedCategories = [
      ...serviceUsage.map((cat: any) => ({ ...cat, category_type: 'service' })),
      ...ticketUsage.map((cat: any) => ({ ...cat, category_type: 'ticket' }))
    ].sort((a, b) => b.usage_count - a.usage_count);

    return {
      total_categories: parseInt(String(serviceStats?.count || '0')) + parseInt(String(ticketStats?.count || '0')),
      categories_by_type: {
        service: parseInt(String(serviceStats?.count || '0')),
        ticket: parseInt(String(ticketStats?.count || '0'))
      },
      most_used_categories: mostUsedCategories.map((cat: any) => ({
        category_id: cat.category_id,
        category_name: cat.category_name,
        usage_count: parseInt(String(cat.usage_count)),
        category_type: cat.category_type
      })),
      hierarchy_depth_stats: hierarchyStats
    };
  }

  /**
   * Generate tag cloud data
   */
  async getTagCloud(
    options: {
      entity_type?: TaggedEntityType;
      channel_id?: string;
      min_usage?: number;
      max_tags?: number;
    } = {},
    context: ServiceContext
  ): Promise<TagCloudData> {
    const { knex } = await this.getKnex();

    let query = knex('tags')
      .where('tenant', context.tenant);

    if (options.entity_type) {
      query = query.where('tagged_type', options.entity_type);
    }
    if (options.channel_id) {
      query = query.where('channel_id', options.channel_id);
    }

    const tagStats = await query
      .select(
        'tag_text',
        'background_color',
        'text_color',
        knex.raw('COUNT(*) as usage_count')
      )
      .groupBy('tag_text', 'background_color', 'text_color')
      .having('COUNT(*)', '>=', options.min_usage || 1)
      .orderBy('usage_count', 'desc')
      .limit(options.max_tags || 50);

    if (tagStats.length === 0) {
      return {
        tags: [],
        max_weight: 0,
        total_tags: 0
      };
    }

    const maxUsage = Math.max(...tagStats.map((t: any) => parseInt(t.usage_count)));
    const minUsage = Math.min(...tagStats.map((t: any) => parseInt(t.usage_count)));

    const tags = tagStats.map((tag: any) => {
      const usage = parseInt(tag.usage_count);
      // Calculate weight (0.2 to 1.0 scale)
      const weight = minUsage === maxUsage ? 1.0 : 
        0.2 + (0.8 * (usage - minUsage) / (maxUsage - minUsage));

      return {
        tag_text: tag.tag_text,
        weight,
        usage_count: usage,
        background_color: tag.background_color,
        text_color: tag.text_color
      };
    });

    return {
      tags,
      max_weight: 1.0,
      total_tags: tagStats.length
    };
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
      const deleted = await trx('tags')
        .whereIn('tag_id', tagIds)
        .where('tenant', context.tenant)
        .delete();

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
      // Get source tags
      const sourceTags = await trx('tags')
        .whereIn('tag_id', sourceTagIds)
        .where('tenant', context.tenant);

      if (sourceTags.length === 0) {
        return { merged: 0, created: 0 };
      }

      let created = 0;
      let merged = 0;

      // Group by entity to avoid duplicates
      const entitiesByType = sourceTags.reduce((acc: any, tag: any) => {
        const key = `${tag.tagged_type}:${tag.tagged_id}`;
        if (!acc[key]) {
          acc[key] = {
            tagged_type: tag.tagged_type,
            tagged_id: tag.tagged_id,
            channel_id: tag.channel_id
          };
        }
        return acc;
      }, {});

      // Create new merged tags
      for (const entity of Object.values(entitiesByType) as any[]) {
        // Check if target tag already exists for this entity
        const existing = await trx('tags')
          .where({
            tag_text: targetTagText.toLowerCase().trim(),
            tagged_id: entity.tagged_id,
            tagged_type: entity.tagged_type,
            tenant: context.tenant
          })
          .first();

        if (!existing) {
          const tagData = {
            tag_text: targetTagText.toLowerCase().trim(),
            tagged_id: entity.tagged_id,
            tagged_type: entity.tagged_type,
            channel_id: entity.channel_id,
            background_color: targetColors.background_color || null,
            text_color: targetColors.text_color || null
          };

          await Tag.insert(trx, tagData);
          created++;
        }
        merged++;
      }

      // Delete source tags
      await trx('tags')
        .whereIn('tag_id', sourceTagIds)
        .where('tenant', context.tenant)
        .delete();

      return { merged, created };
    });
  }

  /**
   * Bulk delete categories
   */
  async bulkDeleteCategories(
    categoryIds: string[],
    categoryType: 'service' | 'ticket',
    force: boolean = false,
    context: ServiceContext
  ): Promise<BulkCategoryResult> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const result: BulkCategoryResult = {
        created: 0,
        updated: 0,
        deleted: 0,
        errors: []
      };

      for (const categoryId of categoryIds) {
        try {
          if (categoryType === 'service') {
            // Check if service category is in use
            if (!force) {
              const inUse = await trx('services')
                .where({ service_category: categoryId, tenant: context.tenant })
                .first();

              if (inUse) {
                result.errors.push({
                  category_id: categoryId,
                  error: 'Category is in use by services'
                });
                continue;
              }
            }

            const deleted = await trx('service_categories')
              .where({ category_id: categoryId, tenant: context.tenant })
              .delete();

            if (deleted > 0) {
              result.deleted++;
            }
          } else {
            // Ticket category
            if (!force) {
              // Check for subcategories
              const hasSubcategories = await trx('categories')
                .where({
                  parent_category: categoryId,
                  tenant: context.tenant
                })
                .first();

              if (hasSubcategories) {
                result.errors.push({
                  category_id: categoryId,
                  error: 'Category has subcategories'
                });
                continue;
              }

              // Check if in use by tickets
              const inUse = await trx('tickets')
                .where(function() {
                  this.where({ category_id: categoryId, tenant: context.tenant })
                      .orWhere({ subcategory_id: categoryId, tenant: context.tenant });
                })
                .first();

              if (inUse) {
                result.errors.push({
                  category_id: categoryId,
                  error: 'Category is in use by tickets'
                });
                continue;
              }
            }

            const deleted = await trx('categories')
              .where({ category_id: categoryId, tenant: context.tenant })
              .delete();

            if (deleted > 0) {
              result.deleted++;
            }
          }
        } catch (error) {
          result.errors.push({
            category_id: categoryId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return result;
    });
  }

  // ========================================================================
  // UTILITY AND HELPER METHODS
  // ========================================================================

  /**
   * Enrich categories with hierarchy information
   */
  private async enrichCategoriesWithHierarchy(
    categories: ITicketCategory[],
    context: ServiceContext
  ): Promise<TicketCategoryResponse[]> {
    const { knex } = await this.getKnex();

    const enriched: TicketCategoryResponse[] = [];

    for (const category of categories) {
      const enrichedCategory: TicketCategoryResponse = {
        category_id: category.category_id,
        category_name: category.category_name,
        parent_category: category.parent_category || null,
        channel_id: category.channel_id,
        created_by: category.created_by,
        created_at: category.created_at ? category.created_at.toISOString() : new Date().toISOString(),
        tenant: category.tenant
      };

      // Calculate depth and path
      const { depth, path } = await this.calculateCategoryDepthAndPath(
        category.category_id,
        context
      );

      enrichedCategory.depth = depth;
      enrichedCategory.path = path;

      // Get children if this is a parent category
      const children = await knex('categories')
        .where({
          parent_category: category.category_id,
          tenant: context.tenant
        })
        .orderBy('category_name', 'asc');

      if (children.length > 0) {
        enrichedCategory.children = await this.enrichCategoriesWithHierarchy(children, context);
      }

      enriched.push(enrichedCategory);
    }

    return enriched;
  }

  /**
   * Build category tree structure
   */
  private buildCategoryTree(categories: ITicketCategory[]): CategoryTreeNode[] {
    const categoryMap = new Map<string, CategoryTreeNode>();
    const rootCategories: CategoryTreeNode[] = [];

    // First pass: create all nodes
    categories.forEach(category => {
      const node: CategoryTreeNode = {
        category_id: category.category_id,
        category_name: category.category_name,
        parent_category: category.parent_category || null,
        children: [],
        depth: 0,
        path: category.category_name
      };
      categoryMap.set(category.category_id, node);
    });

    // Second pass: build tree structure and calculate depths
    categories.forEach(category => {
      const node = categoryMap.get(category.category_id)!;
      
      if (category.parent_category) {
        const parent = categoryMap.get(category.parent_category);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
          node.path = `${parent.path} > ${node.category_name}`;
        }
      } else {
        rootCategories.push(node);
      }
    });

    return rootCategories;
  }

  /**
   * Check for circular hierarchy
   */
  private async checkCircularHierarchy(
    parentId: string,
    childId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<boolean> {
    if (parentId === childId) {
      return true;
    }

    const parent = await trx('categories')
      .where({
        category_id: parentId,
        tenant: context.tenant
      })
      .first();

    if (!parent || !parent.parent_category) {
      return false;
    }

    return await this.checkCircularHierarchy(parent.parent_category, childId, context, trx);
  }

  /**
   * Calculate category depth and path
   */
  private async calculateCategoryDepthAndPath(
    categoryId: string,
    context: ServiceContext
  ): Promise<{ depth: number; path: string }> {
    const { knex } = await this.getKnex();

    const category = await knex('categories')
      .where({
        category_id: categoryId,
        tenant: context.tenant
      })
      .first();

    if (!category) {
      return { depth: 0, path: '' };
    }

    let depth = 0;
    let path = category.category_name;
    let currentId = category.parent_category;

    // Walk up the hierarchy
    while (currentId && depth < 10) { // Prevent infinite loops
      const parent = await knex('categories')
        .where({
          category_id: currentId,
          tenant: context.tenant
        })
        .first();

      if (!parent) break;

      depth++;
      path = `${parent.category_name} > ${path}`;
      currentId = parent.parent_category;
    }

    return { depth, path };
  }

  /**
   * Get category hierarchy depth statistics
   */
  private async getCategoryHierarchyStats(
    context: ServiceContext
  ): Promise<Record<number, number>> {
    const { knex } = await this.getKnex();

    // This is a simplified version - in a real implementation,
    // you might want to use a recursive CTE for better performance
    const categories = await knex('categories')
      .where('tenant', context.tenant)
      .select('category_id', 'parent_category');

    const depthCounts: Record<number, number> = {};
    
    for (const category of categories) {
      const depth = await this.calculateCategoryDepth(category.category_id, categories);
      depthCounts[depth] = (depthCounts[depth] || 0) + 1;
    }

    return depthCounts;
  }

  /**
   * Calculate category depth from category list
   */
  private calculateCategoryDepth(
    categoryId: string,
    categories: Array<{ category_id: string; parent_category: string | null }>
  ): number {
    const category = categories.find(c => c.category_id === categoryId);
    if (!category || !category.parent_category) {
      return 0;
    }

    return 1 + this.calculateCategoryDepth(category.parent_category, categories);
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(query: string, text: string): number {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    if (textLower === queryLower) {
      return 1.0;
    } else if (textLower.startsWith(queryLower)) {
      return 0.9;
    } else if (textLower.includes(queryLower)) {
      const position = textLower.indexOf(queryLower);
      return 0.7 - (position / text.length) * 0.2;
    } else {
      return 0.5;
    }
  }

  // ========================================================================
  // HATEOAS LINK GENERATION
  // ========================================================================

  /**
   * Generate HATEOAS links for API discoverability
   */
  generateLinks(
    resourceType: 'tag' | 'category',
    resourceId: string,
    baseUrl: string = '/api/v1'
  ): Record<string, { href: string; method: string; title: string }> {
    const links: Record<string, { href: string; method: string; title: string }> = {};

    if (resourceType === 'tag') {
      links.self = {
        href: `${baseUrl}/tags/${resourceId}`,
        method: 'GET',
        title: 'Get tag details'
      };
      links.update = {
        href: `${baseUrl}/tags/${resourceId}`,
        method: 'PUT',
        title: 'Update tag'
      };
      links.delete = {
        href: `${baseUrl}/tags/${resourceId}`,
        method: 'DELETE',
        title: 'Delete tag'
      };
      links.entities = {
        href: `${baseUrl}/tags/${resourceId}/entities`,
        method: 'GET',
        title: 'Get tagged entities'
      };
      links.usage = {
        href: `${baseUrl}/tags/${resourceId}/usage`,
        method: 'GET',
        title: 'Get tag usage statistics'
      };
    } else if (resourceType === 'category') {
      links.self = {
        href: `${baseUrl}/categories/${resourceId}`,
        method: 'GET',
        title: 'Get category details'
      };
      links.update = {
        href: `${baseUrl}/categories/${resourceId}`,
        method: 'PUT',
        title: 'Update category'
      };
      links.delete = {
        href: `${baseUrl}/categories/${resourceId}`,
        method: 'DELETE',
        title: 'Delete category'
      };
      links.children = {
        href: `${baseUrl}/categories/${resourceId}/children`,
        method: 'GET',
        title: 'Get child categories'
      };
      links.tree = {
        href: `${baseUrl}/categories/${resourceId}/tree`,
        method: 'GET',
        title: 'Get category tree'
      };
      links.usage = {
        href: `${baseUrl}/categories/${resourceId}/usage`,
        method: 'GET',
        title: 'Get category usage statistics'
      };
    }

    return links;
  }
}