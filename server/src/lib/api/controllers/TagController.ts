/**
 * Tag Controller
 * REST API controller for tag operations with full CRUD, bulk operations,
 * analytics, search, and entity association support
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { TagService } from '../services/TagService';
import {
  // Tag Schemas
  createTagSchema,
  updateTagSchema,
  tagListQuerySchema,
  createBulkTagsSchema,
  updateTagColorSchema,
  updateTagTextSchema,
  deleteTagsByTextSchema,
  // Entity Tagging Schemas
  tagEntitySchema,
  untagEntitySchema,
  bulkTagEntitiesSchema,
  bulkUntagEntitiesSchema,
  // Search Schemas
  tagSearchSchema,
  // Analytics Schemas
  tagAnalyticsFilterSchema,
  // Bulk Operations Schemas
  bulkDeleteTagsSchema,
  bulkMergeTagsSchema,
  // Import/Export Schemas
  importTagsSchema,
  // Type Exports
  CreateTagData,
  UpdateTagData,
  TaggedEntityType
} from '../schemas/tagSchemas';
import {
  withAuth,
  withPermission,
  withValidation,
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';

export class TagController extends BaseController {
  private tagService: TagService;

  constructor() {
    // Initialize service first
    const tagService = new TagService();
    
    super(tagService, {
      resource: 'tag',
      createSchema: createTagSchema,
      updateSchema: updateTagSchema,
      querySchema: tagListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.tagService = tagService;
    this.registerEndpoints();
  }

  /**
   * Register all endpoints with metadata system
   * TODO: Fix ApiRegistry interface issues
   */
  private registerEndpoints() {
    // Basic Tag CRUD Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'List tags with advanced filtering',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagListQuerySchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Create a new tag',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: createTagSchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tag by ID',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'PUT',
      resource: 'tag',
      action: 'update',
      description: 'Update tag',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: updateTagSchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Delete tag',
      permissions: { resource: 'tag', action: 'delete' },
      tags: ['tags']
    });

    // Entity Tagging Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entity/{entityType}/{entityId}',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tags for a specific entity',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags', 'entities']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entity',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Add tags to an entity',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: tagEntitySchema,
      tags: ['tags', 'entities']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entity',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Remove tags from an entity',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: untagEntitySchema,
      tags: ['tags', 'entities']
    });

    // Search and Analytics Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/search',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Search tags with advanced filtering',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagSearchSchema,
      tags: ['tags', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/analytics',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tag analytics and usage statistics',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagAnalyticsFilterSchema,
      tags: ['tags', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/cloud',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Generate tag cloud data',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags', 'analytics']
    });

    // Bulk Operations Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/create',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Bulk create tags for an entity',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: createBulkTagsSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/delete',
      method: 'POST',
      resource: 'tag',
      action: 'delete',
      description: 'Bulk delete tags',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: bulkDeleteTagsSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/merge',
      method: 'POST',
      resource: 'tag',
      action: 'update',
      description: 'Bulk merge tags',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: bulkMergeTagsSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/entities',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Bulk tag multiple entities',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: bulkTagEntitiesSchema,
      tags: ['tags', 'bulk-operations', 'entities']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/entities',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Bulk untag multiple entities',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: bulkUntagEntitiesSchema,
      tags: ['tags', 'bulk-operations', 'entities']
    });

    // Tag Modification Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/colors',
      method: 'PUT',
      resource: 'tag',
      action: 'update',
      description: 'Update tag colors for all instances of a tag',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: updateTagColorSchema,
      tags: ['tags', 'modification']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}/text',
      method: 'PUT',
      resource: 'tag',
      action: 'update',
      description: 'Update tag text for all instances of a tag',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: updateTagTextSchema,
      tags: ['tags', 'modification']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/by-text',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Delete all instances of a tag by text and type',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: deleteTagsByTextSchema,
      tags: ['tags', 'modification']
    });
  }

  // ========================================================================
  // TAG CRUD OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags - List tags
   */
  listTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const result = await this.tagService.searchTags('', validatedQuery, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        validatedQuery.offset || 0,
        validatedQuery.limit || 25,
        { resource: 'tag', filters: validatedQuery }
      );
    });
  }

  /**
   * GET /api/v1/tags/{id} - Get tag by ID
   */
  getTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const tag = await this.tagService.getTagById(id, req.context!);
      
      if (!tag) {
        throw new NotFoundError('Tag not found');
      }

      return createSuccessResponse(tag);
    });
  }

  /**
   * POST /api/v1/tags - Create tag
   */
  createTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(createTagSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTagData) => {
      const tag = await this.tagService.createTag(validatedData, req.context!);
      
      return createSuccessResponse(tag, 201);
    });
  }

  /**
   * PUT /api/v1/tags/{id} - Update tag
   */
  updateTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(updateTagSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateTagData) => {
      const id = this.extractIdFromPath(req);
      const tag = await this.tagService.updateTag(id, validatedData, req.context!);
      
      return createSuccessResponse(tag);
    });
  }

  /**
   * DELETE /api/v1/tags/{id} - Delete tag
   */
  deleteTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      await this.tagService.deleteTag(id, req.context!);
      
      return createSuccessResponse({ message: 'Tag deleted successfully' });
    });
  }

  // ========================================================================
  // ENTITY TAGGING OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags/entity/{entityType}/{entityId} - Get tags by entity
   */
  getTagsByEntity() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const entityType = this.extractPathParam(req, 'entityType') as TaggedEntityType;
      const entityId = this.extractPathParam(req, 'entityId');
      
      const tags = await this.tagService.getTagsByEntity(entityId, entityType, req.context!);
      
      return createSuccessResponse({
        entity_id: entityId,
        entity_type: entityType,
        tags,
        total_tags: tags.length
      });
    });
  }

  /**
   * POST /api/v1/tags/entity - Tag entity
   */
  tagEntity() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(tagEntitySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const tagTexts = validatedData.tags.map((tag: any) => 
        typeof tag === 'string' ? tag : tag.tag_text
      );
      
      const tags = await this.tagService.tagEntity(
        validatedData.entity_id,
        validatedData.entity_type,
        tagTexts,
        {},
        req.context!
      );
      
      return createSuccessResponse({
        entity_id: validatedData.entity_id,
        entity_type: validatedData.entity_type,
        tags,
        created_count: tags.length
      }, 201);
    });
  }

  /**
   * DELETE /api/v1/tags/entity - Untag entity
   */
  untagEntity() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(untagEntitySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      await this.tagService.untagEntity(
        validatedData.entity_id,
        validatedData.entity_type,
        validatedData.tag_ids,
        req.context!
      );
      
      return createSuccessResponse({
        entity_id: validatedData.entity_id,
        entity_type: validatedData.entity_type,
        removed_count: validatedData.tag_ids.length,
        message: 'Tags removed successfully'
      });
    });
  }

  // ========================================================================
  // SEARCH AND ANALYTICS
  // ========================================================================

  /**
   * GET /api/v1/tags/search - Search tags
   */
  searchTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const results = await this.tagService.searchTags(
        validatedQuery.search_term,
        validatedQuery,
        req.context!
      );
      
      return createPaginatedResponse(
        results.data,
        results.total,
        validatedQuery.offset || 0,
        validatedQuery.limit || 25,
        { resource: 'tag', search_term: validatedQuery.search_term }
      );
    });
  }

  /**
   * GET /api/v1/tags/analytics - Get tag analytics
   */
  getTagAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagAnalyticsFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const analytics = await this.tagService.getTagAnalytics(
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        analytics,
        generated_at: new Date().toISOString()
      });
    });
  }

  /**
   * GET /api/v1/tags/cloud - Generate tag cloud
   */
  getTagCloud() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const entityType = url.searchParams.get('entity_type') as TaggedEntityType | null;
      const limit = parseInt(url.searchParams.get('limit') || '50');
      
      const tagCloud = await this.tagService.getTagCloudData(entityType, limit, req.context!);
      
      return createSuccessResponse({
        tags: tagCloud,
        total_tags: tagCloud.length,
        max_weight: Math.max(...tagCloud.map(t => t.weight), 0)
      });
    });
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * POST /api/v1/tags/bulk/create - Bulk create tags
   */
  bulkCreateTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(createBulkTagsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const tags = await this.tagService.tagEntity(
        validatedData.tagged_id,
        validatedData.tagged_type,
        validatedData.tag_texts,
        {
          channel_id: validatedData.channel_id,
          default_colors: validatedData.default_colors
        },
        req.context!
      );
      
      return createSuccessResponse({
        tags,
        created_count: tags.length,
        message: 'Tags created successfully'
      }, 201);
    });
  }

  /**
   * POST /api/v1/tags/bulk/delete - Bulk delete tags
   */
  bulkDeleteTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(bulkDeleteTagsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.tagService.bulkDeleteTags(
        validatedData.ids,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Bulk delete completed: ${result.deleted} tags deleted`,
        ...result
      });
    });
  }

  /**
   * POST /api/v1/tags/bulk/merge - Bulk merge tags
   */
  bulkMergeTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(bulkMergeTagsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.tagService.bulkMergeTags(
        validatedData.source_tag_ids,
        validatedData.target_tag_text,
        validatedData.target_colors || {},
        req.context!
      );
      
      return createSuccessResponse({
        message: `Merge completed: ${result.merged} tags merged, ${result.created} new mappings created`,
        ...result
      });
    });
  }

  /**
   * POST /api/v1/tags/bulk/entities - Bulk tag entities
   */
  bulkTagEntities() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(bulkTagEntitiesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const results = [];
      
      for (const entity of validatedData.entities) {
        const tags = await this.tagService.tagEntity(
          entity.entity_id,
          entity.entity_type,
          validatedData.tags,
          {},
          req.context!
        );
        results.push({
          entity_id: entity.entity_id,
          entity_type: entity.entity_type,
          tags_created: tags.length
        });
      }
      
      return createSuccessResponse({
        results,
        total_entities: validatedData.entities.length,
        total_tags_created: results.reduce((sum, r) => sum + r.tags_created, 0),
        message: 'Bulk tagging completed successfully'
      }, 201);
    });
  }

  /**
   * DELETE /api/v1/tags/bulk/entities - Bulk untag entities
   */
  bulkUntagEntities() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(bulkUntagEntitiesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.tagService.bulkUntagEntities(
        validatedData.entities.map((e: any) => e.entity_id),
        validatedData.entities[0].entity_type, // Assume all same type for now
        validatedData.tag_ids,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Bulk untag completed: ${result.removed} tag associations removed`,
        ...result
      });
    });
  }

  // ========================================================================
  // TAG MODIFICATION OPERATIONS
  // ========================================================================

  /**
   * PUT /api/v1/tags/colors - Update tag colors
   */
  updateTagColors() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(updateTagColorSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const url = new URL(req.url);
      const tagText = url.searchParams.get('tag_text')!;
      const entityType = url.searchParams.get('entity_type') as TaggedEntityType;
      
      const result = await this.tagService.updateTagColors(
        tagText,
        entityType,
        validatedData.background_color,
        validatedData.text_color,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Updated colors for ${result.updated} tag instances`,
        ...result
      });
    });
  }

  /**
   * PUT /api/v1/tags/{id}/text - Update tag text
   */
  updateTagText() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(updateTagTextSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const id = this.extractIdFromPath(req);
      const result = await this.tagService.updateTagText(
        id,
        validatedData.tag_text,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Updated tag text from "${result.old_tag_text}" to "${result.new_tag_text}" for ${result.updated_count} instances`,
        ...result
      });
    });
  }

  /**
   * DELETE /api/v1/tags/by-text - Delete tags by text
   */
  deleteTagsByText() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(deleteTagsByTextSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.tagService.deleteTagsByText(
        validatedData.tag_text,
        validatedData.tagged_type,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Deleted ${result.deleted_count} instances of tag "${validatedData.tag_text}"`,
        ...result
      });
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  private extractPathParam(req: ApiRequest, paramName: string): string {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    
    // Find the index of the parameter based on the route structure
    if (paramName === 'entityType') {
      return pathParts[pathParts.length - 2];
    } else if (paramName === 'entityId') {
      return pathParts[pathParts.length - 1];
    }
    
    throw new Error(`Parameter ${paramName} not found in path`);
  }
}

export default TagController;