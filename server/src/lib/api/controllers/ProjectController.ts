/**
 * Project API Controller
 * Handles HTTP requests for project-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { ProjectService } from '../services/ProjectService';
import { 
  createProjectSchema,
  updateProjectSchema,
  projectListQuerySchema,
  createProjectPhaseSchema,
  updateProjectPhaseSchema,
  createProjectTaskSchema,
  updateProjectTaskSchema,
  createTaskChecklistItemSchema,
  updateTaskChecklistItemSchema,
  createProjectTicketLinkSchema,
  projectSearchSchema,
  projectExportQuerySchema,
  bulkUpdateProjectSchema,
  bulkAssignProjectSchema,
  bulkStatusUpdateSchema
} from '../schemas/project';
import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class ProjectController extends BaseController {
  private projectService: ProjectService;

  constructor() {
    super(null as any, {
      resource: 'project',
      permissions: {
        create: 'create',
        read: 'read', 
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    this.projectService = new ProjectService();
  }

  /**
   * GET /api/v1/projects - List projects
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any,
      withValidation(projectListQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const { page, limit, sort, order, ...filters } = query;
      const listOptions = { 
        page: page ? parseInt(page) : undefined, 
        limit: limit ? parseInt(limit) : undefined, 
        sort, 
        order: order as 'asc' | 'desc' | undefined
      };
      
      const result = await this.projectService.list(listOptions, context, filters);
      
      // Add HATEOAS links to each project
      const projectsWithLinks = result.data.map(project => ({
        ...project,
        _links: getHateoasLinks('project', project.project_id)
      }));

      const response = createApiResponse({
        data: projectsWithLinks,
        pagination: {
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 25,
          total: result.total,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 25))
        },
        _links: {
          self: { href: `/api/v1/projects` },
          create: { href: `/api/v1/projects`, method: 'POST' },
          search: { href: `/api/v1/projects/search` },
          export: { href: `/api/v1/projects/export` },
          stats: { href: `/api/v1/projects/stats` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/projects/{id} - Get project details
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const project = await this.projectService.getWithDetails(id, context);
      
      if (!project) {
        return createErrorResponse('Project not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...project,
          _links: getHateoasLinks('project', project.project_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/projects - Create new project
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'create') as any,
      withValidation(createProjectSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const project = await this.projectService.create(data, context);
      
      const response = createApiResponse({
        data: {
          ...project,
          _links: getHateoasLinks('project', project.project_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/{id} - Update project
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(updateProjectSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const project = await this.projectService.update(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...project,
          _links: getHateoasLinks('project', project.project_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/projects/{id} - Delete project
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.projectService.delete(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/projects/{id}/phases - List project phases
   */
  listPhases() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const phases = await this.projectService.getPhases(id, context);
      
      const phasesWithLinks = phases.map(phase => ({
        ...phase,
        _links: getHateoasLinks('project-phase', phase.phase_id, id)
      }));

      const response = createApiResponse({
        data: phasesWithLinks,
        _links: {
          self: { href: `/api/v1/projects/${id}/phases` },
          create: { href: `/api/v1/projects/${id}/phases`, method: 'POST' },
          parent: { href: `/api/v1/projects/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/projects/{id}/phases - Create project phase
   */
  createPhase() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(createProjectPhaseSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const phase = await this.projectService.createPhase(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...phase,
          _links: getHateoasLinks('project-phase', phase.phase_id, id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/{projectId}/phases/{phaseId} - Update project phase
   */
  updatePhase() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(updateProjectPhaseSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { phaseId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const phase = await this.projectService.updatePhase(phaseId, data, context);
      
      const response = createApiResponse({
        data: {
          ...phase,
          _links: getHateoasLinks('project-phase', phase.phase_id, phase.project_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/projects/{projectId}/phases/{phaseId} - Delete project phase
   */
  deletePhase() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { phaseId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.projectService.deletePhase(phaseId, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/projects/{id}/tasks - List project tasks
   */
  listTasks() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const tasks = await this.projectService.getTasks(id, context);
      
      const tasksWithLinks = tasks.map(task => ({
        ...task,
        _links: getHateoasLinks('project-task', task.task_id, id)
      }));

      const response = createApiResponse({
        data: tasksWithLinks,
        _links: {
          self: { href: `/api/v1/projects/${id}/tasks` },
          parent: { href: `/api/v1/projects/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/projects/{projectId}/phases/{phaseId}/tasks - Create project task
   */
  createTask() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(createProjectTaskSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { phaseId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const task = await this.projectService.createTask(phaseId, data, context);
      
      const response = createApiResponse({
        data: {
          ...task,
          _links: getHateoasLinks('project-task', task.task_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/tasks/{taskId} - Update project task
   */
  updateTask() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(updateProjectTaskSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { taskId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const task = await this.projectService.updateTask(taskId, data, context);
      
      const response = createApiResponse({
        data: {
          ...task,
          _links: getHateoasLinks('project-task', task.task_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/projects/tasks/{taskId} - Delete project task
   */
  deleteTask() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { taskId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.projectService.deleteTask(taskId, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/projects/tasks/{taskId}/checklist - Get task checklist items
   */
  getTaskChecklist() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { taskId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const items = await this.projectService.getTaskChecklistItems(taskId, context);
      
      const response = createApiResponse({
        data: items,
        _links: {
          self: { href: `/api/v1/projects/tasks/${taskId}/checklist` },
          create: { href: `/api/v1/projects/tasks/${taskId}/checklist`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/projects/tasks/{taskId}/checklist - Create checklist item
   */
  createChecklistItem() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(createTaskChecklistItemSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { taskId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const item = await this.projectService.createChecklistItem(taskId, data, context);
      
      const response = createApiResponse({ data: item }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/projects/{id}/tickets - List project ticket links
   */
  listTicketLinks() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const links = await this.projectService.getProjectTicketLinks(id, context);
      
      const response = createApiResponse({
        data: links,
        _links: {
          self: { href: `/api/v1/projects/${id}/tickets` },
          create: { href: `/api/v1/projects/${id}/tickets`, method: 'POST' },
          parent: { href: `/api/v1/projects/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/projects/{id}/tickets - Create project ticket link
   */
  createTicketLink() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(createProjectTicketLinkSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const link = await this.projectService.createTicketLink(id, data, context);
      
      const response = createApiResponse({ data: link }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/projects/search - Search projects
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any,
      withValidation(projectSearchSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const projects = await this.projectService.search(query as any, context);
      
      const projectsWithLinks = projects.map(project => ({
        ...project,
        _links: getHateoasLinks('project', project.project_id)
      }));

      const response = createApiResponse({
        data: projectsWithLinks,
        _links: {
          self: { href: `/api/v1/projects/search` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/projects/export - Export projects
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any,
      withValidation(projectExportQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // For now, just return the projects as JSON
      // In a real implementation, you'd generate CSV/Excel based on format
      const projects = await this.projectService.list({}, context);
      
      if (query.format === 'csv') {
        // Convert to CSV format
        const csvData = this.convertToCSV(projects.data);
        return new NextResponse(csvData, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=projects.csv'
          }
        });
      }

      return NextResponse.json(createApiResponse({ data: projects.data }));
    });
  }

  /**
   * GET /api/v1/projects/stats - Get project statistics
   */
  getStatistics() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const stats = await this.projectService.getStatistics(context);
      
      const response = createApiResponse({
        data: stats,
        _links: {
          self: { href: `/api/v1/projects/stats` },
          projects: { href: `/api/v1/projects` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/bulk-update - Bulk update projects
   */
  bulkUpdate() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(bulkUpdateProjectSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await Promise.all(
        data.projects.map(({ project_id, data: updateData }: any) =>
          this.projectService.update(project_id, updateData, context)
        )
      );

      const response = createApiResponse({
        data: results,
        message: `Updated ${results.length} projects`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/bulk-assign - Bulk assign projects
   */
  bulkAssign() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(bulkAssignProjectSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await Promise.all(
        data.project_ids.map((projectId: string) =>
          this.projectService.update(projectId, { assigned_to: data.assigned_to }, context)
        )
      );

      const response = createApiResponse({
        data: results,
        message: `Assigned ${results.length} projects`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/projects/bulk-status - Bulk update project status
   */
  bulkStatusUpdate() {
    const middleware = compose(
      withAuth as any,
      withPermission('project', 'update') as any,
      withValidation(bulkStatusUpdateSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await Promise.all(
        data.project_ids.map((projectId: string) =>
          this.projectService.update(projectId, { status: data.status }, context)
        )
      );

      const response = createApiResponse({
        data: results,
        message: `Updated status for ${results.length} projects`
      });

      return NextResponse.json(response);
    });
  }

  // Helper method to convert data to CSV
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }
}