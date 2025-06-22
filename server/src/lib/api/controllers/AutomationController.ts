/**
 * Automation Controller
 * Comprehensive REST API controller for automation rule management and execution
 * Handles automation rules, executions, templates, analytics, and bulk operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BaseController } from './BaseController';
import { AutomationService } from '../services/AutomationService';
import { 
  // Automation rule schemas
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
  automationRulesListSchema,
  CreateAutomationRule,
  UpdateAutomationRule,
  AutomationRuleFilter,

  // Execution schemas
  manualExecutionSchema,
  automationExecutionsListSchema,
  ManualExecution,
  AutomationExecution,
  AutomationExecutionFilter,

  // Template schemas
  createTemplateFromRuleSchema,
  templatesListSchema,
  CreateTemplateFromRule,
  AutomationTemplate,
  TemplateFilter,

  // Statistics schemas
  performanceMetricsRequestSchema,
  PerformanceMetricsRequest,
  AutomationStats,

  // Bulk operation schemas
  bulkStatusUpdateSchema,
  bulkExecutionSchema,
  BulkStatusUpdate,
  BulkExecution,

  // Types
  AutomationRuleStatus,
  TriggerType,
  ActionType,
  ExecutionStatus
} from '../schemas/automationSchemas';
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

export class AutomationController {
  private automationService: AutomationService;

  constructor() {
    // Note: In a real implementation, these dependencies would be injected
    // For now, we'll assume they're available or mock them as needed
    this.automationService = new AutomationService(
      undefined as any, // DatabaseService - would be injected
      undefined as any, // EventBusService - would be injected  
      undefined as any  // AuditLogService - would be injected
    );
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    // ========================================
    // AUTOMATION RULE ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules',
      method: 'GET',
      resource: 'automation',
      action: 'list',
      description: 'List automation rules with filtering and pagination',
      permissions: { resource: 'automation', action: 'read' },
      querySchema: automationRulesListSchema,
      tags: ['automation', 'rules']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules',
      method: 'POST',
      resource: 'automation',
      action: 'create',
      description: 'Create a new automation rule',
      permissions: { resource: 'automation', action: 'create' },
      requestSchema: createAutomationRuleSchema,
      tags: ['automation', 'rules']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/{id}',
      method: 'GET',
      resource: 'automation',
      action: 'read',
      description: 'Get automation rule details by ID',
      permissions: { resource: 'automation', action: 'read' },
      tags: ['automation', 'rules']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/{id}',
      method: 'PUT',
      resource: 'automation',
      action: 'update',
      description: 'Update automation rule',
      permissions: { resource: 'automation', action: 'update' },
      requestSchema: updateAutomationRuleSchema,
      tags: ['automation', 'rules']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/{id}',
      method: 'DELETE',
      resource: 'automation',
      action: 'delete',
      description: 'Delete an automation rule',
      permissions: { resource: 'automation', action: 'delete' },
      tags: ['automation', 'rules']
    });

    // ========================================
    // AUTOMATION EXECUTION ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/executions',
      method: 'GET',
      resource: 'automation_execution',
      action: 'read',
      description: 'List automation executions with filtering',
      permissions: { resource: 'automation', action: 'read' },
      querySchema: automationExecutionsListSchema,
      tags: ['automation', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/executions/{id}',
      method: 'GET',
      resource: 'automation_execution',
      action: 'read',
      description: 'Get automation execution details',
      permissions: { resource: 'automation', action: 'read' },
      tags: ['automation', 'executions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/{id}/execute',
      method: 'POST',
      resource: 'automation_execution',
      action: 'create',
      description: 'Execute automation rule manually',
      permissions: { resource: 'automation', action: 'execute' },
      requestSchema: manualExecutionSchema,
      tags: ['automation', 'executions', 'manual']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/executions/{id}/retry',
      method: 'POST',
      resource: 'automation_execution',
      action: 'update',
      description: 'Retry failed automation execution',
      permissions: { resource: 'automation', action: 'execute' },
      tags: ['automation', 'executions', 'retry']
    });

    // ========================================
    // AUTOMATION TEMPLATE ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/templates',
      method: 'GET',
      resource: 'automation_template',
      action: 'read',
      description: 'List automation templates',
      permissions: { resource: 'automation', action: 'read' },
      querySchema: templatesListSchema,
      tags: ['automation', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/templates',
      method: 'POST',
      resource: 'automation_template',
      action: 'create',
      description: 'Create template from automation rule',
      permissions: { resource: 'automation', action: 'create' },
      requestSchema: createTemplateFromRuleSchema,
      tags: ['automation', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/templates/{id}',
      method: 'GET',
      resource: 'automation_template',
      action: 'read',
      description: 'Get automation template details',
      permissions: { resource: 'automation', action: 'read' },
      tags: ['automation', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/templates/{id}/use',
      method: 'POST',
      resource: 'automation_template',
      action: 'create',
      description: 'Create automation rule from template',
      permissions: { resource: 'automation', action: 'create' },
      tags: ['automation', 'templates', 'use']
    });

    // ========================================
    // ANALYTICS AND STATISTICS ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/statistics',
      method: 'GET',
      resource: 'automation',
      action: 'read',
      description: 'Get automation statistics and metrics',
      permissions: { resource: 'automation', action: 'read' },
      tags: ['automation', 'statistics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/performance',
      method: 'GET',
      resource: 'automation',
      action: 'read',
      description: 'Get automation performance metrics',
      permissions: { resource: 'automation', action: 'read' },
      querySchema: performanceMetricsRequestSchema,
      tags: ['automation', 'performance']
    });

    // ========================================
    // BULK OPERATION ENDPOINTS
    // ========================================

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/bulk-status',
      method: 'POST',
      resource: 'automation',
      action: 'update',
      description: 'Bulk update automation rule status',
      permissions: { resource: 'automation', action: 'update' },
      requestSchema: bulkStatusUpdateSchema,
      tags: ['automation', 'bulk', 'status']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/automation/rules/bulk-execute',
      method: 'POST',
      resource: 'automation',
      action: 'execute',
      description: 'Bulk execute automation rules',
      permissions: { resource: 'automation', action: 'execute' },
      requestSchema: bulkExecutionSchema,
      tags: ['automation', 'bulk', 'execute']
    });
  }

  // ============================================================================
  // AUTOMATION RULE OPERATIONS
  // ============================================================================

  /**
   * List automation rules with filtering and pagination
   * GET /api/v1/automation/rules
   */
  listAutomationRules() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read'),
      withQueryValidation(automationRulesListSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: AutomationRuleFilter) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.automationService.listAutomationRules(
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
          resource: 'automation_rule'
        }
      );
    });
  }

  /**
   * Create automation rule
   * POST /api/v1/automation/rules
   */
  createAutomationRule() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'create'),
      withValidation(createAutomationRuleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateAutomationRule) => {
      const result = await this.automationService.createAutomationRule(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('automation/rules', result.data.rule_id, '/api/v1')
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Get automation rule by ID
   * GET /api/v1/automation/rules/{id}
   */
  getAutomationRule() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.getAutomationRule(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: {
          ...generateResourceLinks('automation/rules', id, '/api/v1'),
          execute: `/api/v1/automation/rules/${id}/execute`,
          executions: `/api/v1/automation/executions?automation_rule_id=${id}`
        }
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Update automation rule
   * PUT /api/v1/automation/rules/{id}
   */
  updateAutomationRule() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'update'),
      withValidation(updateAutomationRuleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateAutomationRule) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.updateAutomationRule(
        id,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('automation/rules', id, '/api/v1')
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Delete automation rule
   * DELETE /api/v1/automation/rules/{id}
   */
  deleteAutomationRule() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      await this.automationService.deleteAutomationRule(
        id,
        req.context!.tenant,
        req.context!.userId
      );

      return new NextResponse(null, { status: 204 });
    });
  }

  // ============================================================================
  // AUTOMATION EXECUTION OPERATIONS
  // ============================================================================

  /**
   * List automation executions with filtering
   * GET /api/v1/automation/executions
   */
  listAutomationExecutions() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read'),
      withQueryValidation(automationExecutionsListSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: AutomationExecutionFilter) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.automationService.listAutomationExecutions(
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
          resource: 'automation_execution'
        }
      );
    });
  }

  /**
   * Get automation execution by ID
   * GET /api/v1/automation/executions/{id}
   */
  getAutomationExecution() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.getAutomationExecution(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: {
          ...generateResourceLinks('automation/executions', id, '/api/v1'),
          rule: `/api/v1/automation/rules/${result.data.automation_rule_id}`,
          retry: result.data.status === 'failed' ? `/api/v1/automation/executions/${id}/retry` : undefined
        }
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Execute automation rule manually
   * POST /api/v1/automation/rules/{id}/execute
   */
  executeAutomationRule() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'execute'),
      withValidation(manualExecutionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: ManualExecution) => {
      const ruleId = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.executeAutomationRule(
        ruleId,
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: {
          execution: `/api/v1/automation/executions/${result.data.execution_id}`,
          rule: `/api/v1/automation/rules/${ruleId}`
        }
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Retry failed automation execution
   * POST /api/v1/automation/executions/{id}/retry
   */
  retryAutomationExecution() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'execute')
    );

    return middleware(async (req: ApiRequest) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.retryAutomationExecution(
        id,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: {
          execution: `/api/v1/automation/executions/${id}`,
          rule: `/api/v1/automation/rules/${result.data.automation_rule_id}`
        }
      };

      return createSuccessResponse(response);
    });
  }

  // ============================================================================
  // AUTOMATION TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * List automation templates
   * GET /api/v1/automation/templates
   */
  listAutomationTemplates() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read'),
      withQueryValidation(templatesListSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: TemplateFilter) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const result = await this.automationService.listAutomationTemplates(
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
          resource: 'automation_template'
        }
      );
    });
  }

  /**
   * Get automation template by ID
   * GET /api/v1/automation/templates/{id}
   */
  getAutomationTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.getAutomationTemplate(
        id,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: {
          ...generateResourceLinks('automation/templates', id, '/api/v1'),
          use: `/api/v1/automation/templates/${id}/use`
        }
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Create template from automation rule
   * POST /api/v1/automation/templates
   */
  createAutomationTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'create'),
      withValidation(createTemplateFromRuleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTemplateFromRule) => {
      const result = await this.automationService.createAutomationTemplate(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: generateResourceLinks('automation/templates', result.data.template_id, '/api/v1')
      };

      return createSuccessResponse(response, 201);
    });
  }

  /**
   * Create automation rule from template
   * POST /api/v1/automation/templates/{id}/use
   */
  useAutomationTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'create'),
      withValidation(z.object({
        variables: z.record(z.any()).optional().default({})
      }))
    );

    return middleware(async (req: ApiRequest, validatedData: { variables: Record<string, any> }) => {
      const templateId = new URL(req.url).pathname.split('/').pop()!;
      
      const result = await this.automationService.createRuleFromTemplate(
        templateId,
        validatedData.variables,
        req.context!.tenant,
        req.context!.userId
      );

      const response = {
        ...result.data,
        _links: {
          rule: `/api/v1/automation/rules/${result.data.rule_id}`,
          template: `/api/v1/automation/templates/${templateId}`
        }
      };

      return createSuccessResponse(response, 201);
    });
  }

  // ============================================================================
  // ANALYTICS AND STATISTICS OPERATIONS
  // ============================================================================

  /**
   * Get automation statistics
   * GET /api/v1/automation/statistics
   */
  getAutomationStatistics() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const result = await this.automationService.getAutomationStatistics(
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: {
          self: '/api/v1/automation/statistics',
          rules: '/api/v1/automation/rules',
          executions: '/api/v1/automation/executions',
          templates: '/api/v1/automation/templates',
          performance: '/api/v1/automation/performance'
        }
      };

      return createSuccessResponse(response);
    });
  }

  /**
   * Get automation performance metrics
   * GET /api/v1/automation/performance
   */
  getAutomationPerformance() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read'),
      withQueryValidation(performanceMetricsRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: PerformanceMetricsRequest) => {
      const result = await this.automationService.getPerformanceMetrics(
        validatedQuery,
        req.context!.tenant
      );

      const response = {
        ...result.data,
        _links: {
          self: '/api/v1/automation/performance',
          statistics: '/api/v1/automation/statistics'
        }
      };

      return createSuccessResponse(response);
    });
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk update automation rule status
   * POST /api/v1/automation/rules/bulk-status
   */
  bulkUpdateStatus() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'update'),
      withValidation(bulkStatusUpdateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkStatusUpdate) => {
      const result = await this.automationService.bulkUpdateStatus(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        action: 'bulk_status_update',
        status: validatedData.status,
        rule_ids: validatedData.ids,
        updated: result.data.updated,
        errors: result.data.errors,
        message: `Bulk status update completed: ${result.data.updated} successful, ${result.data.errors.length} failed`
      });
    });
  }

  /**
   * Bulk execute automation rules
   * POST /api/v1/automation/rules/bulk-execute
   */
  bulkExecuteRules() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'execute'),
      withValidation(bulkExecutionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkExecution) => {
      const result = await this.automationService.bulkExecute(
        validatedData,
        req.context!.tenant,
        req.context!.userId
      );

      return createSuccessResponse({
        action: 'bulk_execute',
        rule_ids: validatedData.automation_rule_ids,
        started: result.data.started,
        errors: result.data.errors,
        sequential: validatedData.sequential_execution,
        message: `Bulk execution completed: ${result.data.started} started, ${result.data.errors.length} failed`
      });
    });
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get automation rule types and categories
   * GET /api/v1/automation/meta
   */
  getAutomationMeta() {
    const middleware = compose(
      withAuth,
      withPermission('automation', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const meta = {
        trigger_types: [
          'time_based',
          'event_based',
          'condition_based',
          'manual',
          'recurring',
          'webhook'
        ],
        action_types: [
          'email_notification',
          'sms_notification',
          'webhook_call',
          'database_update',
          'ticket_creation',
          'ticket_update',
          'project_update',
          'time_entry_creation',
          'invoice_generation',
          'custom_script',
          'workflow_execution',
          'system_command'
        ],
        rule_statuses: [
          'active',
          'inactive',
          'draft',
          'error'
        ],
        execution_statuses: [
          'pending',
          'running',
          'completed',
          'failed',
          'cancelled',
          'timeout',
          'skipped'
        ],
        priority_levels: [
          'low',
          'normal',
          'high',
          'critical'
        ],
        condition_operators: [
          'equals',
          'not_equals',
          'greater_than',
          'less_than',
          'greater_than_or_equal',
          'less_than_or_equal',
          'contains',
          'not_contains',
          'starts_with',
          'ends_with',
          'in',
          'not_in',
          'exists',
          'not_exists',
          'regex_match'
        ]
      };

      return createSuccessResponse(meta);
    });
  }
}