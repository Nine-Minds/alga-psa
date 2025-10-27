/**
 * API Project Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { ProjectService } from '@product/api/services/ProjectService';
import { 
  createProjectSchema,
  updateProjectSchema,
  projectListQuerySchema,
  projectSearchSchema,
  projectExportQuerySchema
} from '@product/api/schemas/project';
import { 
  ApiKeyServiceForApi 
} from '@server/lib/services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '@product/actions/user-actions/findUserByIdForApi';
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
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiProjectController extends ApiBaseController {
  private projectService: ProjectService;

  constructor() {
    const projectService = new ProjectService();
    
    super(projectService, {
      resource: 'project',
      createSchema: createProjectSchema,
      updateSchema: updateProjectSchema,
      querySchema: projectListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.projectService = projectService;
  }

  /**
   * Search projects
   */
  search() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Check permissions
        await this.checkPermission(apiRequest, 'read');

        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {

          // Validate query
          let validatedQuery;
          try {
            const url = new URL(req.url);
            const query: Record<string, any> = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            validatedQuery = projectSearchSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.projectService.searchProjects(
            validatedQuery,
            apiRequest.context!
          );

          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get project statistics
   */
  stats() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Check permissions
        await this.checkPermission(apiRequest, 'read');

        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {

          const stats = await this.projectService.getProjectStats(apiRequest.context);
          
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export projects
   */
  export() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Check permissions
        await this.checkPermission(apiRequest, 'read');

        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {

          // Validate query
          let validatedQuery;
          try {
            const url = new URL(req.url);
            const query: Record<string, any> = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            validatedQuery = projectExportQuerySchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const { format = 'csv', ...filters } = validatedQuery;
          
          const data = await this.projectService.exportProjects(
            filters,
            format,
            apiRequest.context!
          );

          if (format === 'csv') {
            return new NextResponse(data as string, {
              headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="projects.csv"'
              }
            });
          }

          return createSuccessResponse(data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get project tasks
   */
  getTasks() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract project ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const projectId = pathParts[projectsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          // Verify project exists
          const project = await this.projectService.getById(projectId, apiRequest.context!);
          if (!project) {
            throw new NotFoundError('Project not found');
          }

          const tasks = await this.projectService.getProjectTasks(
            projectId,
            apiRequest.context!
          );
          
          return createSuccessResponse(tasks);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get project tickets
   */
  getTickets() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract project ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const projectId = pathParts[projectsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          // Verify project exists
          const project = await this.projectService.getById(projectId, apiRequest.context!);
          if (!project) {
            throw new NotFoundError('Project not found');
          }

          // Get pagination params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const tickets = await this.projectService.getProjectTickets(
            projectId,
            { page, limit },
            apiRequest.context!
          );
          
          return createPaginatedResponse(
            tickets.data,
            tickets.total,
            page,
            limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk update projects
   */
  bulkUpdate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();
          const { projectIds, updates } = data;

          const results = await this.projectService.bulkUpdateProjects(
            projectIds,
            updates,
            apiRequest.context!
          );

          return createSuccessResponse(results);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk assign projects
   */
  bulkAssign() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();
          const { projectIds, assignments } = data;

          const results = await this.projectService.bulkAssign(
            projectIds,
            assignments,
            apiRequest.context!
          );

          return createSuccessResponse(results);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk status update
   */
  bulkStatusUpdate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();
          const { projectIds, status } = data;

          const results = await this.projectService.bulkStatusUpdate(
            projectIds,
            status,
            apiRequest.context!
          );

          return createSuccessResponse(results);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List project phases
   */
  listPhases() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract project ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const projectId = pathParts[projectsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          // Check project exists
          const project = await this.projectService.getById(projectId, apiRequest.context!);
          if (!project) {
            throw new NotFoundError('Project not found');
          }

          const phases = await this.projectService.listPhases(
            projectId,
            apiRequest.context!
          );

          return createSuccessResponse(phases);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create project phase
   */
  createPhase() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract project ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const projectId = pathParts[projectsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Check project exists
          const project = await this.projectService.getById(projectId, apiRequest.context!);
          if (!project) {
            throw new NotFoundError('Project not found');
          }

          // Parse body
          const data = await req.json();

          const phase = await this.projectService.createPhase(
            projectId,
            data,
            apiRequest.context!
          );

          return createSuccessResponse(phase, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update project phase
   */
  updatePhase() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract IDs from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const phaseId = pathParts[pathParts.length - 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();

          const phase = await this.projectService.updatePhase(
            phaseId,
            data,
            apiRequest.context!
          );

          if (!phase) {
            throw new NotFoundError('Phase not found');
          }

          return createSuccessResponse(phase);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete project phase
   */
  deletePhase() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract phase ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const phaseId = pathParts[pathParts.length - 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'delete', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot delete project');
          }

          await this.projectService.deletePhase(
            phaseId,
            apiRequest.context!
          );

          return createSuccessResponse(null, 204);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List phase tasks
   */
  listPhaseTasks() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract phase ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const phasesIndex = pathParts.findIndex(part => part === 'phases');
        const phaseId = pathParts[phasesIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          const tasks = await this.projectService.listPhaseTasks(
            phaseId,
            apiRequest.context!
          );

          return createSuccessResponse(tasks);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get task details
   */
  getTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract task ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const taskId = pathParts[pathParts.length - 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          const task = await this.projectService.getTaskById(
            taskId,
            apiRequest.context!
          );

          if (!task) {
            throw new NotFoundError('Task not found');
          }

          return createSuccessResponse(task);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update task
   */
  updateTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract task ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const taskId = pathParts[pathParts.length - 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();

          const task = await this.projectService.updateTask(
            taskId,
            data,
            apiRequest.context!
          );

          if (!task) {
            throw new NotFoundError('Task not found');
          }

          return createSuccessResponse(task);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete task
   */
  deleteTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract task ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const taskId = pathParts[pathParts.length - 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'delete', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot delete project');
          }

          await this.projectService.deleteTask(
            taskId,
            apiRequest.context!
          );

          return createSuccessResponse(null, 204);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get task checklist
   */
  getTaskChecklist() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract task ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const tasksIndex = pathParts.findIndex(part => part === 'tasks');
        const taskId = pathParts[tasksIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          const checklist = await this.projectService.getTaskChecklistItems(
            taskId,
            apiRequest.context!
          );

          return createSuccessResponse(checklist);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create checklist item
   */
  createChecklistItem() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract task ID from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const tasksIndex = pathParts.findIndex(part => part === 'tasks');
        const taskId = pathParts[tasksIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          // Parse body
          const data = await req.json();

          const checklistItem = await this.projectService.createChecklistItem(
            taskId,
            data,
            apiRequest.context!
          );

          return createSuccessResponse(checklistItem, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}