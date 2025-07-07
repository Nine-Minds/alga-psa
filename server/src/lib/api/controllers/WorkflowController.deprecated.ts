/**
 * Workflow Controller - DEPRECATED
 * 
 * @deprecated This controller has been replaced by ApiWorkflowControllerV2
 * All workflow routes now use the new V2 controller which provides:
 * - Proper API key authentication
 * - Simplified architecture
 * - Better error handling
 * - Consistent with other V2 controllers
 * 
 * This file will be removed in a future version.
 * Use ApiWorkflowControllerV2 instead.
 * 
 * Comprehensive REST API controller for workflow management operations
 * Handles workflow registrations, executions, events, tasks, templates, triggers, and analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { WorkflowService } from '../services/WorkflowService';
import { 
  // Registration schemas
  createWorkflowRegistrationSchema,
  updateWorkflowRegistrationSchema,
  workflowRegistrationListQuerySchema,
  CreateWorkflowRegistrationData,
  UpdateWorkflowRegistrationData,
  WorkflowRegistrationResponse,
  WorkflowRegistrationFilterData,

  // Execution schemas
  createWorkflowExecutionSchema,
  updateWorkflowExecutionSchema,
  workflowExecutionListQuerySchema,
  CreateWorkflowExecutionData,
  UpdateWorkflowExecutionData,
  WorkflowExecutionResponse,
  WorkflowExecutionFilterData,

  // Event schemas
  createWorkflowEventSchema,
  workflowEventListQuerySchema,
  CreateWorkflowEventData,
  WorkflowEventResponse,
  WorkflowEventFilterData,

  // Task schemas
  createWorkflowTaskSchema,
  updateWorkflowTaskSchema,
  completeWorkflowTaskSchema,
  workflowTaskListQuerySchema,
  CreateWorkflowTaskData,
  UpdateWorkflowTaskData,
  CompleteWorkflowTaskData,
  WorkflowTaskResponse,
  WorkflowTaskFilterData,

  // Template schemas
  createWorkflowTemplateSchema,
  updateWorkflowTemplateSchema,
  workflowTemplateListQuerySchema,
  CreateWorkflowTemplateData,
  UpdateWorkflowTemplateData,
  WorkflowTemplateResponse,
  WorkflowTemplateFilterData,

  // Trigger schemas
  createWorkflowTriggerSchema,
  updateWorkflowTriggerSchema,
  workflowTriggerListQuerySchema,
  CreateWorkflowTriggerData,
  UpdateWorkflowTriggerData,
  WorkflowTriggerResponse,
  WorkflowTriggerFilterData,

  // Bulk operation schemas
  bulkCreateWorkflowExecutionSchema,
  bulkWorkflowActionSchema,
  bulkTaskAssignmentSchema,
  BulkCreateWorkflowExecutionData,
  BulkWorkflowActionData,
  BulkTaskAssignmentData,

  // Search and analytics schemas
  workflowSearchSchema,
  workflowAnalyticsQuerySchema,
  WorkflowSearchData,
  WorkflowAnalyticsQuery,
  WorkflowAnalyticsResponse,

  // Version and import/export schemas
  createWorkflowVersionSchema,
  workflowExportQuerySchema,
  workflowImportSchema,
  CreateWorkflowVersionData,
  WorkflowVersionResponse,
  WorkflowExportQuery,
  WorkflowImportData,

  // Timer and snapshot schemas
  createWorkflowTimerSchema,
  createWorkflowSnapshotSchema,
  CreateWorkflowTimerData,
  WorkflowTimerResponse,
  CreateWorkflowSnapshotData,
  WorkflowSnapshotResponse,

  // Action result schemas
  WorkflowActionResultResponse
} from '../schemas/workflowSchemas';
import { 
  withAuth, 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';
import { generateResourceLinks } from '../utils/responseHelpers';

export class WorkflowController extends BaseController {
  private workflowService: WorkflowService;

  constructor() {
    const workflowService = new WorkflowService(
      undefined as any, // DatabaseService - would be injected
      undefined as any, // EventBusService - would be injected  
      undefined as any  // AuditLogService - would be injected
    );
    
    super(null as any, {
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
    });

    this.workflowService = workflowService;
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    // ========================================
    // WORKFLOW REGISTRATION ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows',
      method: 'GET',
      resource: 'workflow',
      action: 'list',
      description: 'List workflow registrations with filtering and pagination',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowRegistrationListQuerySchema,
      tags: ['workflows', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows',
      method: 'POST',
      resource: 'workflow',
      action: 'create',
      description: 'Create a new workflow registration',
      permissions: { resource: 'workflow', action: 'create' },
      requestSchema: createWorkflowRegistrationSchema,
      tags: ['workflows', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/{id}',
      method: 'GET',
      resource: 'workflow',
      action: 'read',
      description: 'Get workflow registration details by ID',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/{id}',
      method: 'PUT',
      resource: 'workflow',
      action: 'update',
      description: 'Update workflow registration',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: updateWorkflowRegistrationSchema,
      tags: ['workflows', 'management']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/{id}',
      method: 'DELETE',
      resource: 'workflow',
      action: 'delete',
      description: 'Delete a workflow registration',
      permissions: { resource: 'workflow', action: 'delete' },
      tags: ['workflows', 'management']
    });

    // ========================================
    // WORKFLOW EXECUTION ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions',
      method: 'GET',
      resource: 'workflow_execution',
      action: 'read',
      description: 'List workflow executions with filtering',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowExecutionListQuerySchema,
      tags: ['workflows', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'create',
      description: 'Create a new workflow execution',
      permissions: { resource: 'workflow', action: 'execute' },
      requestSchema: createWorkflowExecutionSchema,
      tags: ['workflows', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}',
      method: 'GET',
      resource: 'workflow_execution',
      action: 'read',
      description: 'Get workflow execution details',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}',
      method: 'PUT',
      resource: 'workflow_execution',
      action: 'update',
      description: 'Update workflow execution status',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: updateWorkflowExecutionSchema,
      tags: ['workflows', 'executions']
    });

    // Execution control endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}/pause',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'update',
      description: 'Pause workflow execution',
      permissions: { resource: 'workflow', action: 'execute' },
      tags: ['workflows', 'executions', 'control']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}/resume',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'update',
      description: 'Resume workflow execution',
      permissions: { resource: 'workflow', action: 'execute' },
      tags: ['workflows', 'executions', 'control']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}/cancel',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'update',
      description: 'Cancel workflow execution',
      permissions: { resource: 'workflow', action: 'execute' },
      tags: ['workflows', 'executions', 'control']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/{id}/restart',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'create',
      description: 'Restart workflow execution',
      permissions: { resource: 'workflow', action: 'execute' },
      tags: ['workflows', 'executions', 'control']
    });

    // ========================================
    // WORKFLOW EVENT ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-events',
      method: 'GET',
      resource: 'workflow_event',
      action: 'read',
      description: 'List workflow events with filtering',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowEventListQuerySchema,
      tags: ['workflows', 'events']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-events',
      method: 'POST',
      resource: 'workflow_event',
      action: 'create',
      description: 'Create a new workflow event',
      permissions: { resource: 'workflow', action: 'execute' },
      requestSchema: createWorkflowEventSchema,
      tags: ['workflows', 'events']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-events/{id}',
      method: 'GET',
      resource: 'workflow_event',
      action: 'read',
      description: 'Get workflow event details',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'events']
    });

    // ========================================
    // WORKFLOW TASK ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks',
      method: 'GET',
      resource: 'workflow_task',
      action: 'read',
      description: 'List workflow tasks with filtering',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowTaskListQuerySchema,
      tags: ['workflows', 'tasks']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks',
      method: 'POST',
      resource: 'workflow_task',
      action: 'create',
      description: 'Create a new workflow task',
      permissions: { resource: 'workflow', action: 'create' },
      requestSchema: createWorkflowTaskSchema,
      tags: ['workflows', 'tasks']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks/{id}',
      method: 'GET',
      resource: 'workflow_task',
      action: 'read',
      description: 'Get workflow task details',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'tasks']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks/{id}',
      method: 'PUT',
      resource: 'workflow_task',
      action: 'update',
      description: 'Update workflow task',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: updateWorkflowTaskSchema,
      tags: ['workflows', 'tasks']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks/{id}/claim',
      method: 'POST',
      resource: 'workflow_task',
      action: 'update',
      description: 'Claim workflow task for execution',
      permissions: { resource: 'workflow', action: 'execute' },
      tags: ['workflows', 'tasks', 'actions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks/{id}/complete',
      method: 'POST',
      resource: 'workflow_task',
      action: 'update',
      description: 'Complete workflow task',
      permissions: { resource: 'workflow', action: 'execute' },
      requestSchema: completeWorkflowTaskSchema,
      tags: ['workflows', 'tasks', 'actions']
    });

    // ========================================
    // WORKFLOW TEMPLATE ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-templates',
      method: 'GET',
      resource: 'workflow_template',
      action: 'read',
      description: 'List workflow templates',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowTemplateListQuerySchema,
      tags: ['workflows', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-templates',
      method: 'POST',
      resource: 'workflow_template',
      action: 'create',
      description: 'Create workflow template',
      permissions: { resource: 'workflow', action: 'create' },
      requestSchema: createWorkflowTemplateSchema,
      tags: ['workflows', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-templates/{id}',
      method: 'GET',
      resource: 'workflow_template',
      action: 'read',
      description: 'Get workflow template details',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-templates/{id}',
      method: 'PUT',
      resource: 'workflow_template',
      action: 'update',
      description: 'Update workflow template',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: updateWorkflowTemplateSchema,
      tags: ['workflows', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-templates/{id}',
      method: 'DELETE',
      resource: 'workflow_template',
      action: 'delete',
      description: 'Delete workflow template',
      permissions: { resource: 'workflow', action: 'delete' },
      tags: ['workflows', 'templates']
    });

    // ========================================
    // WORKFLOW TRIGGER ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-triggers',
      method: 'GET',
      resource: 'workflow_trigger',
      action: 'read',
      description: 'List workflow triggers',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowTriggerListQuerySchema,
      tags: ['workflows', 'triggers']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-triggers',
      method: 'POST',
      resource: 'workflow_trigger',
      action: 'create',
      description: 'Create workflow trigger',
      permissions: { resource: 'workflow', action: 'create' },
      requestSchema: createWorkflowTriggerSchema,
      tags: ['workflows', 'triggers']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-triggers/{id}',
      method: 'GET',
      resource: 'workflow_trigger',
      action: 'read',
      description: 'Get workflow trigger details',
      permissions: { resource: 'workflow', action: 'read' },
      tags: ['workflows', 'triggers']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-triggers/{id}',
      method: 'PUT',
      resource: 'workflow_trigger',
      action: 'update',
      description: 'Update workflow trigger',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: updateWorkflowTriggerSchema,
      tags: ['workflows', 'triggers']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-triggers/{id}',
      method: 'DELETE',
      resource: 'workflow_trigger',
      action: 'delete',
      description: 'Delete workflow trigger',
      permissions: { resource: 'workflow', action: 'delete' },
      tags: ['workflows', 'triggers']
    });

    // ========================================
    // ANALYTICS AND SEARCH ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/search',
      method: 'GET',
      resource: 'workflow',
      action: 'read',
      description: 'Advanced workflow search',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowSearchSchema,
      tags: ['workflows', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/analytics',
      method: 'GET',
      resource: 'workflow',
      action: 'read',
      description: 'Get workflow analytics and metrics',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowAnalyticsQuerySchema,
      tags: ['workflows', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/export',
      method: 'GET',
      resource: 'workflow',
      action: 'read',
      description: 'Export workflows to various formats',
      permissions: { resource: 'workflow', action: 'read' },
      querySchema: workflowExportQuerySchema,
      tags: ['workflows', 'export']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflows/import',
      method: 'POST',
      resource: 'workflow',
      action: 'create',
      description: 'Import workflows from file',
      permissions: { resource: 'workflow', action: 'create' },
      requestSchema: workflowImportSchema,
      tags: ['workflows', 'import']
    });

    // ========================================
    // BULK OPERATION ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/bulk',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'create',
      description: 'Bulk create workflow executions',
      permissions: { resource: 'workflow', action: 'execute' },
      requestSchema: bulkCreateWorkflowExecutionSchema,
      tags: ['workflows', 'bulk', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-executions/bulk-action',
      method: 'POST',
      resource: 'workflow_execution',
      action: 'update',
      description: 'Bulk workflow execution actions',
      permissions: { resource: 'workflow', action: 'execute' },
      requestSchema: bulkWorkflowActionSchema,
      tags: ['workflows', 'bulk', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/workflow-tasks/bulk-assign',
      method: 'POST',
      resource: 'workflow_task',
      action: 'update',
      description: 'Bulk assign workflow tasks',
      permissions: { resource: 'workflow', action: 'update' },
      requestSchema: bulkTaskAssignmentSchema,
      tags: ['workflows', 'bulk', 'tasks']
    });
  }

  // ============================================================================
  // WORKFLOW REGISTRATION OPERATIONS
  // ============================================================================

  /**
   * List workflow registrations with filtering
   */
  listWorkflowRegistrations() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowRegistrationListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowRegistrationFilterData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.workflowService.listWorkflowRegistrations(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Create workflow registration
   */
  createWorkflowRegistration() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'create'),
      withValidation(createWorkflowRegistrationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateWorkflowRegistrationData) => {
      const result = await this.workflowService.createWorkflowRegistration(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflows', result.data.registration_id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Get workflow registration by ID
   */
  getWorkflowRegistration() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.getWorkflowRegistration(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflows', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Update workflow registration
   */
  updateWorkflowRegistration() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'update'),
      withValidation(updateWorkflowRegistrationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateWorkflowRegistrationData) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowRegistration(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflows', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Delete workflow registration
   */
  deleteWorkflowRegistration() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      await this.workflowService.deleteWorkflowRegistration(
        id,
        req.context!.tenant,
        req.context!.userId
      );

      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // WORKFLOW EXECUTION OPERATIONS
  // ============================================================================

  /**
   * List workflow executions
   */
  listWorkflowExecutions() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowExecutionListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowExecutionFilterData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.workflowService.listWorkflowExecutions(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Create workflow execution
   */
  createWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute'),
      withValidation(createWorkflowExecutionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateWorkflowExecutionData) => {
      const result = await this.workflowService.createWorkflowExecution(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-executions', result.data.execution_id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Get workflow execution by ID
   */
  getWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.getWorkflowExecution(
        id,
        req.context!.tenant
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
  }

  /**
   * Update workflow execution
   */
  updateWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'update'),
      withValidation(updateWorkflowExecutionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateWorkflowExecutionData) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowExecution(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-executions', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Pause workflow execution
   */
  pauseWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowExecution(
        id,
        { status: 'paused' },
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        execution_id: id,
        status: result.data.status,
        message: 'Workflow execution paused successfully'
      });
    });
  }

  /**
   * Resume workflow execution
   */
  resumeWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowExecution(
        id,
        { status: 'running' },
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        execution_id: id,
        status: result.data.status,
        message: 'Workflow execution resumed successfully'
      });
    });
  }

  /**
   * Cancel workflow execution
   */
  cancelWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowExecution(
        id,
        { status: 'cancelled' },
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        execution_id: id,
        status: result.data.status,
        message: 'Workflow execution cancelled successfully'
      });
    });
  }

  /**
   * Restart workflow execution
   */
  restartWorkflowExecution() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      // Get the original execution to restart it
      const original = await this.workflowService.getWorkflowExecution(
        id,
        req.context!.tenant
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
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        original_execution_id: id,
        new_execution_id: newExecution.data.execution_id,
        message: 'Workflow execution restarted successfully',
        _links: generateResourceLinks('workflow-executions', newExecution.data.execution_id, "/api/v1", ["read", "update", "delete"])
      });
    });
  }

  // ============================================================================
  // WORKFLOW EVENT OPERATIONS
  // ============================================================================

  /**
   * List workflow events
   */
  listWorkflowEvents() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowEventListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowEventFilterData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.workflowService.listWorkflowEvents(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Create workflow event
   */
  createWorkflowEvent() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute'),
      withValidation(createWorkflowEventSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateWorkflowEventData) => {
      const result = await this.workflowService.createWorkflowEvent(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-events', result.data.event_id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Get workflow event by ID
   */
  getWorkflowEvent() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.getWorkflowEvent(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-events', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  // ============================================================================
  // WORKFLOW TASK OPERATIONS
  // ============================================================================

  /**
   * List workflow tasks
   */
  listWorkflowTasks() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowTaskListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowTaskFilterData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.workflowService.listWorkflowTasks(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Create workflow task
   */
  createWorkflowTask() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'create'),
      withValidation(createWorkflowTaskSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateWorkflowTaskData) => {
      const result = await this.workflowService.createWorkflowTask(
        validatedData,
        req.context!.tenant,
        req.context!.userId
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
  }

  /**
   * Get workflow task by ID
   */
  getWorkflowTask() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.getWorkflowTask(
        id,
        req.context!.tenant
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
  }

  /**
   * Update workflow task
   */
  updateWorkflowTask() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'update'),
      withValidation(updateWorkflowTaskSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateWorkflowTaskData) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowTask(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Claim workflow task
   */
  claimWorkflowTask() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.claimWorkflowTask(
        id,
        req.context!.tenant,
        req.context!.userId
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
  }

  /**
   * Complete workflow task
   */
  completeWorkflowTask() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute'),
      withValidation(completeWorkflowTaskSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CompleteWorkflowTaskData) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.completeWorkflowTask(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-tasks', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  // ============================================================================
  // WORKFLOW TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * List workflow templates
   */
  listWorkflowTemplates() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowTemplateListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowTemplateFilterData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.workflowService.listWorkflowTemplates(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Create workflow template
   */
  createWorkflowTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'create'),
      withValidation(createWorkflowTemplateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateWorkflowTemplateData) => {
      const result = await this.workflowService.createWorkflowTemplate(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-templates', result.data.template_id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Get workflow template by ID
   */
  getWorkflowTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.getWorkflowTemplate(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-templates', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Update workflow template
   */
  updateWorkflowTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'update'),
      withValidation(updateWorkflowTemplateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateWorkflowTemplateData) => {
      const id = this.extractIdFromPath(req);
      
      const result = await this.workflowService.updateWorkflowTemplate(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('workflow-templates', id, "/api/v1", ["read", "update", "delete"])
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Delete workflow template
   */
  deleteWorkflowTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      await this.workflowService.deleteWorkflowTemplate(
        id,
        req.context!.tenant,
        req.context!.userId
      );

      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // WORKFLOW TRIGGER OPERATIONS
  // ============================================================================

  /**
   * List workflow triggers
   */
  listWorkflowTriggers() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowTriggerListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowTriggerFilterData) => {
      // Note: The WorkflowService doesn't have trigger methods implemented yet
      // This would need to be implemented in the service layer
      throw new Error('Workflow trigger operations not yet implemented in service layer');
    });
  }

  // ============================================================================
  // SEARCH AND ANALYTICS OPERATIONS
  // ============================================================================

  /**
   * Advanced workflow search
   */
  searchWorkflows() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowSearchData) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      
      const result = await this.workflowService.searchWorkflows(
        validatedQuery,
        req.context!.tenant,
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
  }

  /**
   * Get workflow analytics
   */
  getWorkflowAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowAnalyticsQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowAnalyticsQuery) => {
      const result = await this.workflowService.getWorkflowAnalytics(
        validatedQuery,
        req.context!.tenant
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
  }

  /**
   * Export workflows
   */
  exportWorkflows() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'read'),
      withQueryValidation(workflowExportQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: WorkflowExportQuery) => {
      // Note: Export functionality would need to be implemented in the service layer
      return createSuccessResponse({
        message: 'Export functionality not yet implemented',
        format: validatedQuery.format,
        filters: validatedQuery
      });
    });
  }

  /**
   * Import workflows
   */
  importWorkflows() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'create'),
      withValidation(workflowImportSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: WorkflowImportData) => {
      // Note: Import functionality would need to be implemented in the service layer
      return createSuccessResponse({
        message: 'Import functionality not yet implemented',
        format: validatedData.format,
        options: validatedData.options
      });
    });
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk create workflow executions
   */
  bulkCreateWorkflowExecutions() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute'),
      withValidation(bulkCreateWorkflowExecutionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkCreateWorkflowExecutionData) => {
      const result = await this.workflowService.bulkCreateExecutions(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        executions: result.data,
        total_created: result.data.length,
        message: `Successfully created ${result.data.length} workflow executions`
      });
    });
  }

  /**
   * Bulk workflow execution actions
   */
  bulkWorkflowExecutionAction() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'execute'),
      withValidation(bulkWorkflowActionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkWorkflowActionData) => {
      const result = await this.workflowService.bulkWorkflowAction(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        action: validatedData.action,
        execution_ids: validatedData.execution_ids,
        updated: result.data.updated,
        errors: result.data.errors,
        message: `Bulk ${validatedData.action} completed: ${result.data.updated} successful, ${result.data.errors.length} failed`
      });
    });
  }

  /**
   * Bulk assign workflow tasks
   */
  bulkAssignWorkflowTasks() {
    const middleware = compose(
      withAuth,
      withPermission('workflow', 'update'),
      withValidation(bulkTaskAssignmentSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkTaskAssignmentData) => {
      // Note: Bulk task assignment would need to be implemented in the service layer
      return createSuccessResponse({
        message: 'Bulk task assignment not yet implemented in service layer',
        task_ids: validatedData.task_ids,
        assigned_users: validatedData.assigned_users,
        assigned_roles: validatedData.assigned_roles
      });
    });
  }
}