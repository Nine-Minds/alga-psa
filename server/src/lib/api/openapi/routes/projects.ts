import type { ZodTypeAny } from 'zod';
import {
  createProjectTaskSchema,
  projectTaskStatusMappingResponseSchema,
  projectTaskResponseSchema,
  updateProjectTaskSchema,
} from '../../schemas/project';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerProjectRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Projects';

  const ProjectIdParams = registry.registerSchema(
    'ProjectIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Project UUID.'),
    }),
  );

  const ProjectPhaseTaskParams = registry.registerSchema(
    'ProjectPhaseTaskParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Project UUID.'),
      phaseId: zOpenApi.string().uuid().describe('Project phase UUID.'),
    }),
  );

  const ProjectTaskIdParams = registry.registerSchema(
    'ProjectTaskIdParams',
    zOpenApi.object({
      taskId: zOpenApi.string().uuid().describe('Project task UUID.'),
    }),
  );

  const ProjectTaskApiResponse = registry.registerSchema(
    'ProjectTaskApiResponse',
    projectTaskResponseSchema.omit({
      assigned_user_name: true,
      priority_name: true,
      status_name: true,
    }),
  );

  const ProjectTaskEnvelope = registry.registerSchema(
    'ProjectTaskEnvelope',
    zOpenApi.object({
      data: ProjectTaskApiResponse,
    }),
  );

  const ProjectTaskListEnvelope = registry.registerSchema(
    'ProjectTaskListEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(ProjectTaskApiResponse),
    }),
  );

  const ProjectTaskStatusMappingApiResponse = registry.registerSchema(
    'ProjectTaskStatusMappingApiResponse',
    projectTaskStatusMappingResponseSchema,
  );

  const ProjectTaskStatusMappingListEnvelope = registry.registerSchema(
    'ProjectTaskStatusMappingListEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(ProjectTaskStatusMappingApiResponse),
    }),
  );

  const ProjectTaskUpdateRequest = registry.registerSchema(
    'ProjectTaskUpdateRequest',
    updateProjectTaskSchema.describe(
      'Payload for updating a project task. To change task status, send project_status_mapping_id as a UUID. This endpoint does not accept project_id, phase_id, or human-readable status names.',
    ),
  );

  const ProjectTaskCreateRequest = registry.registerSchema(
    'ProjectTaskCreateRequest',
    createProjectTaskSchema.describe(
      'Payload for creating a project task within a phase. Provide project_status_mapping_id as a UUID from the project task status mappings endpoint. The phaseId path parameter selects which phase will receive the task.',
    ),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/projects/{id}/task-status-mappings',
    summary: 'List project task status mappings',
    description:
      'Returns the task status mappings configured for the specified project. Use this endpoint to translate a human-readable status label such as "In Progress" into a project_status_mapping_id UUID before updating a task.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectIdParams,
    },
    responses: {
      200: {
        description: 'Project task status mappings returned successfully.',
        schema: ProjectTaskStatusMappingListEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Project Task Status Mappings',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/projects/{id}/tasks',
    summary: 'List project tasks',
    description:
      'Returns all tasks for the specified project UUID. Use this endpoint to identify a task by task_name before fetching or updating it.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectIdParams,
    },
    responses: {
      200: {
        description: 'Project tasks returned successfully.',
        schema: ProjectTaskListEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Project Tasks',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/projects/{id}/phases/{phaseId}/tasks',
    summary: 'Create project phase task',
    description:
      'Creates a new task in the specified project phase. Resolve phaseId from the project phases and project_status_mapping_id from the project task status mappings before calling this endpoint.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectPhaseTaskParams,
      body: {
        schema: ProjectTaskCreateRequest,
        description: 'Project task creation payload.',
      },
    },
    responses: {
      201: {
        description: 'Project task created successfully.',
        schema: ProjectTaskEnvelope,
      },
      400: {
        description: 'Validation error.',
        schema: deps.ErrorResponse,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project or phase not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'Create Project Phase Task',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/projects/{id}/phases/{phaseId}/tasks',
    summary: 'List project phase tasks',
    description:
      'Returns all tasks for the specified project phase. Both id and phaseId must be UUID path parameters.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectPhaseTaskParams,
    },
    responses: {
      200: {
        description: 'Project phase tasks returned successfully.',
        schema: ProjectTaskListEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project phase not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Project Phase Tasks',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/projects/tasks/{taskId}',
    summary: 'Get project task',
    description: 'Returns a single project task by its task UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectTaskIdParams,
    },
    responses: {
      200: {
        description: 'Project task returned successfully.',
        schema: ProjectTaskEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project task not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Project Task',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/projects/tasks/{taskId}',
    summary: 'Update project task',
    description:
      'Updates a project task by task UUID. Use project_status_mapping_id when changing task status, and only send fields defined in the request schema.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProjectTaskIdParams,
      body: {
        schema: ProjectTaskUpdateRequest,
        description: 'Project task update payload.',
      },
    },
    responses: {
      200: {
        description: 'Project task updated successfully.',
        schema: ProjectTaskEnvelope,
      },
      400: {
        description: 'Validation error.',
        schema: deps.ErrorResponse,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Project task not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'project',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Project Task',
      'x-chat-rbac-resource': 'project',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
