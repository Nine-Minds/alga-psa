/**
 * API Workflow Controller V2
 * Simplified workflow controller that properly handles API key authentication
 * Supports comprehensive workflow management operations including registrations,
 * executions, events, tasks, templates, triggers, and analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { WorkflowService } from '@product/api/services/WorkflowService';
import { 
  createWorkflowRegistrationSchema,
  updateWorkflowRegistrationSchema,
  workflowRegistrationListQuerySchema,
  createWorkflowExecutionSchema,
  updateWorkflowExecutionSchema,
  workflowExecutionListQuerySchema,
  createWorkflowEventSchema,
  workflowEventListQuerySchema,
  createWorkflowTaskSchema,
  updateWorkflowTaskSchema,
  completeWorkflowTaskSchema,
  workflowTaskListQuerySchema,
  createWorkflowTemplateSchema,
  updateWorkflowTemplateSchema,
  workflowTemplateListQuerySchema,
  createWorkflowTriggerSchema,
  updateWorkflowTriggerSchema,
  workflowTriggerListQuerySchema,
  bulkCreateWorkflowExecutionSchema,
  bulkWorkflowActionSchema,
  bulkTaskAssignmentSchema,
  workflowSearchSchema,
  workflowAnalyticsQuerySchema,
  workflowExportQuerySchema,
  workflowImportSchema,
  CreateWorkflowRegistrationData,
  UpdateWorkflowRegistrationData,
  CreateWorkflowExecutionData,
  UpdateWorkflowExecutionData,
  CreateWorkflowEventData,
  CreateWorkflowTaskData,
  UpdateWorkflowTaskData,
  CompleteWorkflowTaskData,
  CreateWorkflowTemplateData,
  UpdateWorkflowTemplateData,
  CreateWorkflowTriggerData,
  UpdateWorkflowTriggerData,
  BulkCreateWorkflowExecutionData,
  BulkWorkflowActionData,
  BulkTaskAssignmentData,
  WorkflowSearchData,
  WorkflowAnalyticsQuery,
  WorkflowExportQuery,
  WorkflowImportData,
  WorkflowRegistrationFilterData,
  WorkflowExecutionFilterData,
  WorkflowEventFilterData,
  WorkflowTaskFilterData,
  WorkflowTemplateFilterData,
  WorkflowTriggerFilterData
} from '@product/api/schemas/workflowSchemas';
import { 
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError,
  NotFoundError,
  ValidationError,
  ApiRequest
} from '@product/api/middleware/apiMiddleware';
import { runWithTenant } from '@server/lib/db';
import { generateResourceLinks } from '@product/api/utils/responseHelpers';

export class ApiWorkflowController extends ApiBaseController {
  private workflowService: WorkflowService;

  constructor() {
    super(
      null as any, // Service will be set properly in real implementation
      {
        resource: 'workflow',
        createSchema: createWorkflowRegistrationSchema,
        updateSchema: updateWorkflowRegistrationSchema,
        querySchema: workflowRegistrationListQuerySchema,
        permissions: {
          create: 'create',
          read: 'read',
          update: 'update',
          delete: 'delete',
          list: 'read'
        }
      }
    );

    // Initialize service (in real implementation, this would be injected)
    this.workflowService = new WorkflowService(
      undefined as any, // DatabaseService
      undefined as any, // EventBusService  
      undefined as any  // AuditLogService
    );
  }

  // ============================================================================
  // WORKFLOW REGISTRATION OPERATIONS
  // ============================================================================

  /**
   * List workflow registrations with filtering
   */
  listWorkflowRegistrations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          // Validate query parameters
          let validatedQuery: WorkflowRegistrationFilterData = {};
          if (this.options.querySchema) {
            validatedQuery = this.validateQuery(apiRequest, this.options.querySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.workflowService.listWorkflowRegistrations(
            validatedQuery,
            apiRequest.context!.tenant,
            page,
            limit
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            {
              filters: validatedQuery,
              resource: 'workflow_registration'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create workflow registration
   */
  createWorkflowRegistration() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const data: CreateWorkflowRegistrationData = await this.validateData(
            apiRequest, 
            createWorkflowRegistrationSchema
          );

          const result = await this.workflowService.createWorkflowRegistration(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflows', result.data.registration_id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow registration by ID
   */
  getWorkflowRegistration() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.getWorkflowRegistration(
            id,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflows', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update workflow registration
   */
  updateWorkflowRegistration() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const data: UpdateWorkflowRegistrationData = await this.validateData(
            apiRequest, 
            updateWorkflowRegistrationSchema
          );
          
          const result = await this.workflowService.updateWorkflowRegistration(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflows', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete workflow registration
   */
  deleteWorkflowRegistration() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          
          await this.workflowService.deleteWorkflowRegistration(
            id,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WORKFLOW EXECUTION OPERATIONS
  // ============================================================================

  /**
   * List workflow executions
   */
  listWorkflowExecutions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          let validatedQuery: WorkflowExecutionFilterData = {};
          if (workflowExecutionListQuerySchema) {
            validatedQuery = this.validateQuery(apiRequest, workflowExecutionListQuerySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.workflowService.listWorkflowExecutions(
            validatedQuery,
            apiRequest.context!.tenant,
            page,
            limit
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            {
              filters: validatedQuery,
              resource: 'workflow_execution'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create workflow execution
   */
  createWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const data: CreateWorkflowExecutionData = await this.validateData(
            apiRequest, 
            createWorkflowExecutionSchema
          );

          const result = await this.workflowService.createWorkflowExecution(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-executions', result.data.execution_id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow execution by ID
   */
  getWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.getWorkflowExecution(
            id,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: {
              ...generateResourceLinks('workflow-executions', id, "/api/v1", ["read", "update", "delete"]),
              events: `/api/v1/workflow-events?execution_id=${id}`,
              tasks: `/api/v1/workflow-tasks?execution_id=${id}`,
              pause: `/api/v1/workflow-executions/${id}/pause`,
              resume: `/api/v1/workflow-executions/${id}/resume`,
              cancel: `/api/v1/workflow-executions/${id}/cancel`,
              restart: `/api/v1/workflow-executions/${id}/restart`
            }
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update workflow execution
   */
  updateWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const data: UpdateWorkflowExecutionData = await this.validateData(
            apiRequest, 
            updateWorkflowExecutionSchema
          );
          
          const result = await this.workflowService.updateWorkflowExecution(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-executions', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Pause workflow execution
   */
  pauseWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.updateWorkflowExecution(
            id,
            { status: 'paused' },
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            execution_id: id,
            status: result.data.status,
            message: 'Workflow execution paused successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Resume workflow execution
   */
  resumeWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.updateWorkflowExecution(
            id,
            { status: 'running' },
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            execution_id: id,
            status: result.data.status,
            message: 'Workflow execution resumed successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Cancel workflow execution
   */
  cancelWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.updateWorkflowExecution(
            id,
            { status: 'cancelled' },
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            execution_id: id,
            status: result.data.status,
            message: 'Workflow execution cancelled successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Restart workflow execution
   */
  restartWorkflowExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Get the original execution to restart it
          const original = await this.workflowService.getWorkflowExecution(
            id,
            apiRequest.context!.tenant
          );

          // Create a new execution with the same parameters
          const newExecution = await this.workflowService.createWorkflowExecution(
            {
              workflow_name: original.data.workflow_name,
              workflow_version: original.data.workflow_version,
              workflow_type: original.data.workflow_type,
              priority: 'medium' as const,
              context_data: original.data.context_data || undefined,
              correlation_id: original.data.correlation_id || undefined
            },
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            original_execution_id: id,
            new_execution_id: newExecution.data.execution_id,
            message: 'Workflow execution restarted successfully',
            _links: generateResourceLinks('workflow-executions', newExecution.data.execution_id, "/api/v1", ["read", "update", "delete"])
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WORKFLOW EVENT OPERATIONS
  // ============================================================================

  /**
   * List workflow events
   */
  listWorkflowEvents() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          let validatedQuery: WorkflowEventFilterData = {};
          if (workflowEventListQuerySchema) {
            validatedQuery = this.validateQuery(apiRequest, workflowEventListQuerySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.workflowService.listWorkflowEvents(
            validatedQuery,
            apiRequest.context!.tenant,
            page,
            limit
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            {
              filters: validatedQuery,
              resource: 'workflow_event'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create workflow event
   */
  createWorkflowEvent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const data: CreateWorkflowEventData = await this.validateData(
            apiRequest, 
            createWorkflowEventSchema
          );

          const result = await this.workflowService.createWorkflowEvent(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-events', result.data.event_id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow event by ID
   */
  getWorkflowEvent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.getWorkflowEvent(
            id,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-events', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WORKFLOW TASK OPERATIONS
  // ============================================================================

  /**
   * List workflow tasks
   */
  listWorkflowTasks() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          let validatedQuery: WorkflowTaskFilterData = {};
          if (workflowTaskListQuerySchema) {
            validatedQuery = this.validateQuery(apiRequest, workflowTaskListQuerySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.workflowService.listWorkflowTasks(
            validatedQuery,
            apiRequest.context!.tenant,
            page,
            limit
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            {
              filters: validatedQuery,
              resource: 'workflow_task'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create workflow task
   */
  createWorkflowTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const data: CreateWorkflowTaskData = await this.validateData(
            apiRequest, 
            createWorkflowTaskSchema
          );

          const result = await this.workflowService.createWorkflowTask(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: {
              ...generateResourceLinks('workflow-tasks', result.data.task_id, "/api/v1", ["read", "update", "delete"]),
              claim: `/api/v1/workflow-tasks/${result.data.task_id}/claim`,
              complete: `/api/v1/workflow-tasks/${result.data.task_id}/complete`
            }
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow task by ID
   */
  getWorkflowTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.getWorkflowTask(
            id,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: {
              ...generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"]),
              claim: `/api/v1/workflow-tasks/${id}/claim`,
              complete: `/api/v1/workflow-tasks/${id}/complete`,
              execution: `/api/v1/workflow-executions/${result.data.execution_id}`
            }
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update workflow task
   */
  updateWorkflowTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const data: UpdateWorkflowTaskData = await this.validateData(
            apiRequest, 
            updateWorkflowTaskSchema
          );
          
          const result = await this.workflowService.updateWorkflowTask(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Claim workflow task
   */
  claimWorkflowTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.claimWorkflowTask(
            id,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: {
              ...generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"]),
              complete: `/api/v1/workflow-tasks/${id}/complete`
            }
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Complete workflow task
   */
  completeWorkflowTask() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          const data: CompleteWorkflowTaskData = await this.validateData(
            apiRequest, 
            completeWorkflowTaskSchema
          );
          
          const result = await this.workflowService.completeWorkflowTask(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WORKFLOW TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * List workflow templates
   */
  listWorkflowTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          let validatedQuery: WorkflowTemplateFilterData = {};
          if (workflowTemplateListQuerySchema) {
            validatedQuery = this.validateQuery(apiRequest, workflowTemplateListQuerySchema);
          }

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.workflowService.listWorkflowTemplates(
            validatedQuery,
            apiRequest.context!.tenant,
            page,
            limit
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            {
              filters: validatedQuery,
              resource: 'workflow_template'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create workflow template
   */
  createWorkflowTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const data: CreateWorkflowTemplateData = await this.validateData(
            apiRequest, 
            createWorkflowTemplateSchema
          );

          const result = await this.workflowService.createWorkflowTemplate(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-templates', result.data.template_id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow template by ID
   */
  getWorkflowTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.workflowService.getWorkflowTemplate(
            id,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-templates', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update workflow template
   */
  updateWorkflowTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const data: UpdateWorkflowTemplateData = await this.validateData(
            apiRequest, 
            updateWorkflowTemplateSchema
          );
          
          const result = await this.workflowService.updateWorkflowTemplate(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('workflow-templates', id, "/api/v1", ["read", "update", "delete"])
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete workflow template
   */
  deleteWorkflowTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          
          await this.workflowService.deleteWorkflowTemplate(
            id,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // SEARCH AND ANALYTICS OPERATIONS
  // ============================================================================

  /**
   * Advanced workflow search
   */
  searchWorkflows() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery: WorkflowSearchData = this.validateQuery(apiRequest, workflowSearchSchema);

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          
          const result = await this.workflowService.searchWorkflows(
            validatedQuery,
            apiRequest.context!.tenant,
            page
          );
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            parseInt(validatedQuery.limit?.toString() || '25'),
            {
              query: validatedQuery.query,
              filters: validatedQuery,
              resource: 'workflow_search'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get workflow analytics
   */
  getWorkflowAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery: WorkflowAnalyticsQuery = this.validateQuery(apiRequest, workflowAnalyticsQuerySchema);

          const result = await this.workflowService.getWorkflowAnalytics(
            validatedQuery,
            apiRequest.context!.tenant
          );

          const response = {
            ...result.data,
            _links: {
              self: `/api/v1/workflows/analytics`,
              workflows: `/api/v1/workflows`,
              executions: `/api/v1/workflow-executions`
            }
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export workflows
   */
  exportWorkflows() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery: WorkflowExportQuery = this.validateQuery(apiRequest, workflowExportQuerySchema);

          // Note: Export functionality would need to be implemented in the service layer
          return createSuccessResponse({
            message: 'Export functionality not yet implemented',
            format: validatedQuery.format,
            filters: validatedQuery
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Import workflows
   */
  importWorkflows() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const data: WorkflowImportData = await this.validateData(
            apiRequest, 
            workflowImportSchema
          );

          // Note: Import functionality would need to be implemented in the service layer
          return createSuccessResponse({
            message: 'Import functionality not yet implemented',
            format: data.format,
            options: data.options
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk create workflow executions
   */
  bulkCreateWorkflowExecutions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const data: BulkCreateWorkflowExecutionData = await this.validateData(
            apiRequest, 
            bulkCreateWorkflowExecutionSchema
          );

          const result = await this.workflowService.bulkCreateExecutions(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            executions: result.data,
            total_created: result.data.length,
            message: `Successfully created ${result.data.length} workflow executions`
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk workflow execution actions
   */
  bulkWorkflowExecutionAction() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const data: BulkWorkflowActionData = await this.validateData(
            apiRequest, 
            bulkWorkflowActionSchema
          );

          const result = await this.workflowService.bulkWorkflowAction(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse({
            action: data.action,
            execution_ids: data.execution_ids,
            updated: result.data.updated,
            errors: result.data.errors,
            message: `Bulk ${data.action} completed: ${result.data.updated} successful, ${result.data.errors.length} failed`
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk assign workflow tasks
   */
  bulkAssignWorkflowTasks() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const data: BulkTaskAssignmentData = await this.validateData(
            apiRequest, 
            bulkTaskAssignmentSchema
          );

          // Note: Bulk task assignment would need to be implemented in the service layer
          return createSuccessResponse({
            message: 'Bulk task assignment not yet implemented in service layer',
            task_ids: data.task_ids,
            assigned_users: data.assigned_users,
            assigned_roles: data.assigned_roles
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================


}