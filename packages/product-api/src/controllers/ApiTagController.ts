/**
 * API Tag Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { TagService } from '@product/api/services/TagService';
import { 
  createTagSchema,
  updateTagSchema,
  tagListQuerySchema,
  createBulkTagsSchema,
  updateTagColorSchema,
  updateTagTextSchema,
  deleteTagsByTextSchema,
  tagEntitySchema,
  untagEntitySchema,
  bulkTagEntitiesSchema,
  bulkUntagEntitiesSchema,
  tagSearchSchema,
  tagAnalyticsFilterSchema,
  bulkDeleteTagsSchema,
  bulkMergeTagsSchema,
  TaggedEntityType
} from '@product/api/schemas/tagSchemas';
import { 
  runWithTenant 
} from '@server/lib/db';
import { 
  getConnection 
} from '@server/lib/db/db';
import { 
  hasPermission 
} from '@server/lib/auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiTagController extends ApiBaseController {
  private tagService: TagService;

  constructor() {
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
  }

  /**
   * Get a single tag by ID
   */
  read() {
    return this.getById();
  }

  /**
   * Override delete to return 204
   */
  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          await this.tagService.deleteTag(id, apiRequest.context!);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Search tags
   */
  search() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = tagSearchSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const results = await this.tagService.searchTags(
            validatedQuery.search_term || '',
            validatedQuery,
            apiRequest.context!
          );
          
          return createPaginatedResponse(
            results.data,
            results.total,
            validatedQuery.offset || 0,
            validatedQuery.limit || 25,
            { resource: 'tag', search_term: validatedQuery.search_term }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get tags by entity
   */
  getEntityTags() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Extract entity type and ID from path
          const url = new URL(req.url);
          const pathParts = url.pathname.split('/');
          const entityIndex = pathParts.indexOf('entity');
          const entityType = pathParts[entityIndex + 1] as TaggedEntityType;
          const entityId = pathParts[entityIndex + 2];
          
          const tags = await this.tagService.getTagsByEntity(entityId, entityType, apiRequest.context!);
          
          return createSuccessResponse({
            entity_id: entityId,
            entity_type: entityType,
            tags,
            total_tags: tags.length
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Tag an entity
   */
  tagEntity() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = tagEntitySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const tagTexts = validatedData.tags.map((tag: any) => 
            typeof tag === 'string' ? tag : tag.tag_text
          );
          
          const tags = await this.tagService.tagEntity(
            validatedData.entity_id,
            validatedData.entity_type,
            tagTexts,
            {},
            apiRequest.context!
          );
          
          return createSuccessResponse({
            entity_id: validatedData.entity_id,
            entity_type: validatedData.entity_type,
            tags,
            created_count: tags.length
          }, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Remove tags from an entity
   */
  untagEntity() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = untagEntitySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          await this.tagService.untagEntity(
            validatedData.entity_id,
            validatedData.entity_type,
            validatedData.tag_ids,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            entity_id: validatedData.entity_id,
            entity_type: validatedData.entity_type,
            removed_count: validatedData.tag_ids.length,
            message: 'Tags removed successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Replace all tags on an entity
   */
  replaceEntityTags() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = tagEntitySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          // First remove all existing tags
          const existingTags = await this.tagService.getTagsByEntity(
            validatedData.entity_id,
            validatedData.entity_type,
            apiRequest.context!
          );
          
          if (existingTags.length > 0) {
            await this.tagService.untagEntity(
              validatedData.entity_id,
              validatedData.entity_type,
              existingTags.map(t => t.tag_id),
              apiRequest.context!
            );
          }

          // Then add new tags
          const tagTexts = validatedData.tags.map((tag: any) => 
            typeof tag === 'string' ? tag : tag.tag_text
          );
          
          const tags = await this.tagService.tagEntity(
            validatedData.entity_id,
            validatedData.entity_type,
            tagTexts,
            {},
            apiRequest.context!
          );
          
          return createSuccessResponse({
            entity_id: validatedData.entity_id,
            entity_type: validatedData.entity_type,
            tags,
            replaced_count: tags.length
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get tag analytics
   */
  analytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = tagAnalyticsFilterSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const analytics = await this.tagService.getTagAnalytics(
            validatedQuery,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            analytics,
            generated_at: new Date().toISOString()
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get tag cloud data
   */
  cloud() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(req.url);
          const entityType = url.searchParams.get('entity_type') as TaggedEntityType | null;
          const limit = parseInt(url.searchParams.get('limit') || '50');
          
          const tagCloud = await this.tagService.getTagCloudData(entityType, limit, apiRequest.context!);
          
          return createSuccessResponse({
            tags: tagCloud,
            total_tags: tagCloud.length,
            max_weight: Math.max(...tagCloud.map(t => t.weight), 0)
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk create tags for an entity
   */
  bulkCreateTags() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = createBulkTagsSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const tags = await this.tagService.tagEntity(
            validatedData.tagged_id,
            validatedData.tagged_type,
            validatedData.tag_texts,
            {
              board_id: validatedData.board_id,
              default_colors: validatedData.default_colors
            },
            apiRequest.context!
          );
          
          return createSuccessResponse({
            tags,
            created_count: tags.length,
            message: 'Tags created successfully'
          }, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk delete tags
   */
  bulkDeleteTags() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = bulkDeleteTagsSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.tagService.bulkDeleteTags(
            validatedData.ids,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Bulk delete completed: ${result.deleted} tags deleted`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk merge tags
   */
  bulkMergeTags() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = bulkMergeTagsSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.tagService.bulkMergeTags(
            validatedData.source_tag_ids,
            validatedData.target_tag_text,
            validatedData.target_colors || {},
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Merge completed: ${result.merged} tags merged, ${result.created} new mappings created`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk tag multiple entities
   */
  bulkTagEntities() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = bulkTagEntitiesSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const results: { entity_id: string; entity_type: string; tags_created: number }[] = [];
          
          for (const entity of validatedData.entities) {
            const tags = await this.tagService.tagEntity(
              entity.entity_id,
              entity.entity_type,
              validatedData.tags,
              {},
              apiRequest.context!
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk remove tags from multiple entities
   */
  bulkUntagEntities() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = bulkUntagEntitiesSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.tagService.bulkUntagEntities(
            validatedData.entities.map((e: any) => e.entity_id),
            validatedData.entities[0].entity_type, // Assume all same type for now
            validatedData.tag_ids,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Bulk untag completed: ${result.removed} tag associations removed`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update tag colors
   */
  updateColors() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = updateTagColorSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const url = new URL(req.url);
          const tagText = url.searchParams.get('tag_text')!;
          const entityType = url.searchParams.get('entity_type') as TaggedEntityType;
          
          const result = await this.tagService.updateTagColors(
            tagText,
            entityType,
            validatedData.background_color || null,
            validatedData.text_color || null,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Updated colors for ${result.updated} tag instances`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update tag text
   */
  updateText() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = updateTagTextSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.tagService.updateTagText(
            id,
            validatedData.tag_text,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Updated tag text from "${result.old_tag_text}" to "${result.new_tag_text}" for ${result.updated_count} instances`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete tags by text
   */
  deleteByText() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'delete');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = deleteTagsByTextSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.tagService.deleteTagsByText(
            validatedData.tag_text,
            validatedData.tagged_type,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Deleted ${result.deleted_count} instances of tag "${validatedData.tag_text}"`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
