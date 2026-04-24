/**
 * API Project Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { ProjectService } from '../services/ProjectService';
import {
  createProjectSchema,
  updateProjectSchema,
  projectListQuerySchema,
  projectSearchSchema,
  projectExportQuerySchema,
  updateProjectTaskSchema,
  createProjectPhaseSchema,
  createProjectTaskSchema
} from '../schemas/project';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import { authorizeApiResourceRead } from './authorizationKernel';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';
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
} from '../middleware/apiMiddleware';
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

  private buildProjectRecordContext(project: Record<string, any>) {
    return {
      id: project.project_id,
      ownerUserId: typeof project.assigned_to === 'string' ? project.assigned_to : undefined,
      assignedUserIds: typeof project.assigned_to === 'string' ? [project.assigned_to] : [],
      clientId: typeof project.client_id === 'string' ? project.client_id : undefined,
      status: project.status,
      isClosed: project.is_closed,
    };
  }

  private async assertProjectReadAllowed(
    apiRequest: AuthenticatedApiRequest,
    projectId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const project = await this.projectService.getById(projectId, apiRequest.context);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const allowed = await authorizeApiResourceRead({
      knex: resolvedKnex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'project',
      recordContext: this.buildProjectRecordContext(project as Record<string, any>),
    });

    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot read project');
    }

    return project as Record<string, any>;
  }

  private buildTicketRecordContext(ticket: Record<string, any>) {
    return {
      id: ticket.ticket_id,
      ownerUserId: typeof ticket.entered_by === 'string' ? ticket.entered_by : undefined,
      assignedUserIds: typeof ticket.assigned_to === 'string' ? [ticket.assigned_to] : [],
      clientId: typeof ticket.client_id === 'string' ? ticket.client_id : undefined,
      boardId: typeof ticket.board_id === 'string' ? ticket.board_id : undefined,
      teamIds: typeof ticket.assigned_team_id === 'string' ? [ticket.assigned_team_id] : [],
      statusId: ticket.status_id,
    };
  }

  private async filterAuthorizedProjects(
    apiRequest: AuthenticatedApiRequest,
    projects: Record<string, any>[],
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>[]> {
    if (projects.length === 0) {
      return [];
    }

    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const allowedByRow = await Promise.all(
      projects.map((project) =>
        authorizeApiResourceRead({
          knex: resolvedKnex,
          tenant: apiRequest.context.tenant,
          user: apiRequest.context.user,
          apiKeyId: apiRequest.context.apiKeyId,
          resource: 'project',
          recordContext: this.buildProjectRecordContext(project),
        })
      )
    );

    return projects.filter((_, index) => allowedByRow[index]);
  }

  private async listAllAuthorizedProjects(
    apiRequest: AuthenticatedApiRequest,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>[]> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const authorizedProjects: Record<string, any>[] = [];
    const pageSize = 100;
    let page = 1;

    for (;;) {
      const result = await this.projectService.list({ page, limit: pageSize }, apiRequest.context);
      if (!Array.isArray(result.data) || result.data.length === 0) {
        break;
      }

      authorizedProjects.push(
        ...(await this.filterAuthorizedProjects(apiRequest, result.data as Record<string, any>[], resolvedKnex))
      );

      if (page * pageSize >= result.total || result.data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return authorizedProjects;
  }

  private async buildProjectStatsFromAuthorizedRows(
    apiRequest: AuthenticatedApiRequest,
    projects: Record<string, any>[],
    knex?: Awaited<ReturnType<typeof getConnection>>
  ) {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const statusIds = Array.from(new Set(projects.map((project) => project.status).filter(Boolean)));
    const clientIds = Array.from(new Set(projects.map((project) => project.client_id).filter(Boolean)));

    const [statuses, clients] = await Promise.all([
      statusIds.length > 0
        ? resolvedKnex('statuses')
            .where({ tenant: apiRequest.context.tenant })
            .whereIn('status_id', statusIds)
            .select('status_id', 'name')
        : Promise.resolve([]),
      clientIds.length > 0
        ? resolvedKnex('clients')
            .where({ tenant: apiRequest.context.tenant })
            .whereIn('client_id', clientIds)
            .select('client_id', 'client_name')
        : Promise.resolve([]),
    ]);

    const statusNameById = new Map<string, string>(
      (statuses as any[]).map((row) => [String(row.status_id), String(row.name)] as [string, string])
    );
    const clientNameById = new Map<string, string>(
      (clients as any[]).map((row) => [String(row.client_id), String(row.client_name)] as [string, string])
    );
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const projectsByStatus = projects.reduce((acc: Record<string, number>, project) => {
      const statusName = String(statusNameById.get(project.status) ?? project.status ?? 'unknown');
      acc[statusName] = (acc[statusName] ?? 0) + 1;
      return acc;
    }, {});

    const clientCounts = projects.reduce((acc: Map<string, number>, project) => {
      if (!project.client_id) {
        return acc;
      }
      acc.set(project.client_id, (acc.get(project.client_id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

    const topClientsByProjectCount = Array.from(clientCounts.entries())
      .map(([clientId, count]) => ({
        client_name: clientNameById.get(clientId) ?? clientId,
        project_count: count,
      }))
      .sort((left, right) => right.project_count - left.project_count)
      .slice(0, 10);

    return {
      total_projects: projects.length,
      active_projects: projects.filter((project) => statusNameById.get(project.status) === 'Active').length,
      completed_projects: projects.filter((project) => statusNameById.get(project.status) === 'Completed').length,
      on_hold_projects: projects.filter((project) => statusNameById.get(project.status) === 'On Hold').length,
      cancelled_projects: projects.filter((project) => statusNameById.get(project.status) === 'Cancelled').length,
      overdue_projects: projects.filter((project) => {
        if (!project.end_date) {
          return false;
        }
        return new Date(project.end_date) < new Date() && statusNameById.get(project.status) !== 'Completed';
      }).length,
      total_budgeted_hours: projects.reduce(
        (sum, project) => sum + Number(project.budgeted_hours ?? 0),
        0,
      ),
      projects_created_this_month: projects.filter(
        (project) => project.created_at && new Date(project.created_at) >= monthStart,
      ).length,
      projects_completed_this_month: projects.filter(
        (project) =>
          statusNameById.get(project.status) === 'Completed' &&
          project.updated_at &&
          new Date(project.updated_at) >= monthStart,
      ).length,
      projects_by_status: projectsByStatus,
      top_clients_by_project_count: topClientsByProjectCount,
    };
  }

  private convertProjectsToCsv(projects: Record<string, any>[]): string {
    if (projects.length === 0) {
      return '';
    }

    const headers = Object.keys(projects[0] ?? {});
    const rows = projects.map((project) =>
      headers
        .map((header) => {
          const value = project[header];
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        })
        .join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  private async resolveProjectIdForPhase(
    phaseId: string,
    tenant: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<string> {
    const resolvedKnex = knex ?? await getConnection(tenant);
    const phase = await resolvedKnex('project_phases')
      .where({ phase_id: phaseId, tenant })
      .first<{ project_id: string }>('project_id');

    if (!phase?.project_id) {
      throw new NotFoundError('Project phase not found');
    }

    return phase.project_id;
  }

  private async resolveProjectIdForTask(
    taskId: string,
    tenant: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<string> {
    const resolvedKnex = knex ?? await getConnection(tenant);
    const task = await resolvedKnex('project_tasks as pt')
      .join('project_phases as pp', function joinProjectPhases(this: any) {
        this.on('pt.phase_id', '=', 'pp.phase_id').andOn('pt.tenant', '=', 'pp.tenant');
      })
      .where({ 'pt.task_id': taskId, 'pt.tenant': tenant })
      .first<{ project_id: string }>('pp.project_id as project_id');

    if (!task?.project_id) {
      throw new NotFoundError('Task not found');
    }

    return task.project_id;
  }

  private async assertPhaseProjectAllowed(
    apiRequest: AuthenticatedApiRequest,
    phaseId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<string> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const projectId = await this.resolveProjectIdForPhase(phaseId, apiRequest.context.tenant, resolvedKnex);
    await this.assertProjectReadAllowed(apiRequest, projectId, resolvedKnex);
    return projectId;
  }

  private async assertTaskProjectAllowed(
    apiRequest: AuthenticatedApiRequest,
    taskId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<string> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const projectId = await this.resolveProjectIdForTask(taskId, apiRequest.context.tenant, resolvedKnex);
    await this.assertProjectReadAllowed(apiRequest, projectId, resolvedKnex);
    return projectId;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.list || 'read');

          let validatedQuery = {};
          if (this.options.querySchema) {
            validatedQuery = this.validateQuery(apiRequest, this.options.querySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'created_at';
          const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

          const filters: any = { ...validatedQuery };
          delete filters.page;
          delete filters.limit;
          delete filters.sort;
          delete filters.order;

          const knex = await getConnection(apiRequest.context.tenant);
          const authorizedPage = await buildAuthorizationAwarePage<Record<string, any>>({
            page,
            limit,
            fetchPage: (sourcePage, sourceLimit) =>
              this.projectService.list(
                { page: sourcePage, limit: sourceLimit, filters, sort, order },
                apiRequest.context,
                filters
              ),
            authorizeRecord: (project) =>
              authorizeApiResourceRead({
                knex,
                tenant: apiRequest.context.tenant,
                user: apiRequest.context.user,
                apiKeyId: apiRequest.context.apiKeyId,
                resource: 'project',
                recordContext: this.buildProjectRecordContext(project),
              }),
            scanLimit: 100,
          });

          return createPaginatedResponse(
            authorizedPage.data,
            authorizedPage.total,
            page,
            limit,
            { sort, order, filters },
            apiRequest,
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
          const id = await this.extractIdFromPath(apiRequest);
          const project = await this.assertProjectReadAllowed(apiRequest, id);

          return createSuccessResponse(project, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Strip internal-only fields from task objects before sending via API.
   * description_rich_text is an internal storage detail — the API only
   * exposes the markdown `description`.
   */
  private stripInternalTaskFields<T extends { description_rich_text?: unknown }>(task: T): Omit<T, 'description_rich_text'> {
    const { description_rich_text, ...rest } = task;
    return rest as Omit<T, 'description_rich_text'>;
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

          const knex = await getConnection(apiRequest.context!.tenant);
          const result = await this.projectService.searchProjects(
            validatedQuery,
            apiRequest.context!
          );
          const authorizedResult = await this.filterAuthorizedProjects(
            apiRequest,
            result as Record<string, any>[],
            knex,
          );

          return createSuccessResponse(authorizedResult);
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

          const knex = await getConnection(apiRequest.context!.tenant);
          const authorizedProjects = await this.listAllAuthorizedProjects(apiRequest, knex);
          const stats = await this.buildProjectStatsFromAuthorizedRows(apiRequest, authorizedProjects, knex);

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
          
          const knex = await getConnection(apiRequest.context!.tenant);
          const exportedProjects = await this.projectService.exportProjects(
            filters,
            'json',
            apiRequest.context!
          );
          const authorizedData = await this.filterAuthorizedProjects(
            apiRequest,
            exportedProjects as Record<string, any>[],
            knex,
          );

          if (format === 'csv') {
            return new NextResponse(this.convertProjectsToCsv(authorizedData), {
              headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="projects.csv"'
              }
            });
          }

          return createSuccessResponse(authorizedData);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

          const tasks = await this.projectService.getProjectTasks(
            projectId,
            apiRequest.context!
          );

          return createSuccessResponse(tasks.map(t => this.stripInternalTaskFields(t)));
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get project task status mappings
   */
  getTaskStatusMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiKey = req.headers.get('x-api-key');

        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

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

        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user,
          apiKeyId: keyRecord.api_key_id,
        };

        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const projectId = pathParts[projectsIndex + 1];

        return await runWithTenant(tenantId!, async () => {
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read project');
          }

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

          const mappings = await this.projectService.getProjectTaskStatusMappings(
            projectId,
            apiRequest.context!
          );

          return createSuccessResponse(mappings);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

          // Get pagination params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const authorizedPage = await buildAuthorizationAwarePage<Record<string, any>>({
            page,
            limit,
            fetchPage: (sourcePage, sourceLimit) =>
              this.projectService.getProjectTickets(
                projectId,
                { page: sourcePage, limit: sourceLimit },
                apiRequest.context!
              ),
            authorizeRecord: (ticket) =>
              authorizeApiResourceRead({
                knex,
                tenant: tenantId!,
                user,
                apiKeyId: keyRecord.api_key_id,
                resource: 'ticket',
                recordContext: this.buildTicketRecordContext(ticket),
              }),
            scanLimit: 100,
          });
          
          return createPaginatedResponse(
            authorizedPage.data,
            authorizedPage.total,
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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          await Promise.all(
            (Array.isArray(projectIds) ? projectIds : []).map((projectId: string) =>
              this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex)
            )
          );

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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          await Promise.all(
            (Array.isArray(projectIds) ? projectIds : []).map((projectId: string) =>
              this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex)
            )
          );

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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          await Promise.all(
            (Array.isArray(projectIds) ? projectIds : []).map((projectId: string) =>
              this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex)
            )
          );

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

          // Parse and validate body
          const data = await this.validateData(apiRequest as AuthenticatedApiRequest, createProjectPhaseSchema);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertPhaseProjectAllowed(apiRequest as AuthenticatedApiRequest, phaseId, knex);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertPhaseProjectAllowed(apiRequest as AuthenticatedApiRequest, phaseId, knex);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertPhaseProjectAllowed(apiRequest as AuthenticatedApiRequest, phaseId, knex);

          const tasks = await this.projectService.listPhaseTasks(
            phaseId,
            apiRequest.context!
          );

          return createSuccessResponse(tasks.map(t => this.stripInternalTaskFields(t)));
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create project phase task
   */
  createPhaseTask() {
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
          user,
          apiKeyId: keyRecord.api_key_id,
        };

        // Extract IDs from URL
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const projectsIndex = pathParts.findIndex(part => part === 'projects');
        const phasesIndex = pathParts.findIndex(part => part === 'phases');
        const projectId = pathParts[projectsIndex + 1];
        const phaseId = pathParts[phasesIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'project', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update project');
          }

          await this.assertProjectReadAllowed(apiRequest as AuthenticatedApiRequest, projectId, knex);

          const phase = await knex('project_phases')
            .where({ phase_id: phaseId, project_id: projectId, tenant: tenantId })
            .first('phase_id');

          if (!phase) {
            throw new NotFoundError('Project phase not found');
          }

          const data = await this.validateData(
            apiRequest as AuthenticatedApiRequest,
            createProjectTaskSchema,
          );

          const task = await this.projectService.createTask(
            phaseId,
            data,
            apiRequest.context!
          );

          return createSuccessResponse(task, 201);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);

          const task = await this.projectService.getTaskById(
            taskId,
            apiRequest.context!
          );

          if (!task) {
            throw new NotFoundError('Task not found');
          }

          return createSuccessResponse(this.stripInternalTaskFields(task));
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);

          // Parse and validate body — strips unrecognized fields like
          // description_rich_text so they can't be written via the API.
          const raw = await req.json();
          const data = updateProjectTaskSchema.parse(raw);

          // When the API updates description (markdown), null out
          // description_rich_text so the UI falls back to the new
          // markdown instead of showing stale rich text.
          const updatePayload = data.description !== undefined
            ? { ...data, description_rich_text: null }
            : data;

          const task = await this.projectService.updateTask(
            taskId,
            updatePayload,
            apiRequest.context!
          );

          if (!task) {
            throw new NotFoundError('Task not found');
          }

          return createSuccessResponse(this.stripInternalTaskFields(task));
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);

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

  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertProjectReadAllowed(apiRequest, id, knex);

          const data = this.options.updateSchema
            ? await this.validateData(apiRequest, this.options.updateSchema)
            : await apiRequest.json();

          const updated = await this.service.update(id, data, apiRequest.context);
          if (!updated) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }

          return createSuccessResponse(updated);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertProjectReadAllowed(apiRequest, id, knex);

          const resource = await this.service.getById(id, apiRequest.context);
          if (!resource) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }

          await this.service.delete(id, apiRequest.context);
          return new NextResponse(null, { status: 204 });
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);

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
