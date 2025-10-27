/**
 * API Automation Controller V2
 * Simplified version with proper API key authentication
 * Handles automation rules, executions, templates, analytics, and bulk operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { AutomationService } from '@product/api/services/AutomationService';
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
} from '@product/api/schemas/automationSchemas';
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
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { generateResourceLinks } from '@product/api/utils/responseHelpers';
import { z } from 'zod';
import { ZodError } from 'zod';

export class ApiAutomationController extends ApiBaseController {
  private automationService: AutomationService;

  constructor() {
    const automationService = new AutomationService(
      undefined as any, // DatabaseService - would be injected
      undefined as any, // EventBusService - would be injected  
      undefined as any  // AuditLogService - would be injected
    );
    
    // Pass null as service since AutomationService doesn't implement BaseService
    super(null as any, {
      resource: 'automation',
      createSchema: createAutomationRuleSchema,
      updateSchema: updateAutomationRuleSchema,
      querySchema: automationRulesListSchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.automationService = automationService;
  }

  /**
   * Validate query parameters
   */
  private validateQueryParams(req: ApiRequest, schema: z.ZodSchema): any {
    try {
      const url = new URL(req.url);
      const query: Record<string, any> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return schema.parse(query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Query validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Validate request data
   */
  private async validateRequestData(req: ApiRequest, schema: z.ZodSchema): Promise<any> {
    try {
      const body = await req.json().catch(() => ({}));
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
  }

  // ============================================================================
  // AUTOMATION RULE OPERATIONS
  // ============================================================================

  /**
   * List automation rules with filtering and pagination
   * GET /api/v1/automation/rules
   */
  listAutomationRules() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery = this.validateQueryParams(apiRequest, automationRulesListSchema);

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.automationService.listAutomationRules(
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
              resource: 'automation_rule'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create automation rule
   * POST /api/v1/automation/rules
   */
  createAutomationRule() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const validatedData = await this.validateRequestData(apiRequest, createAutomationRuleSchema);

          const result = await this.automationService.createAutomationRule(
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('automation/rules', result.data.rule_id, '/api/v1')
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get automation rule by ID
   * GET /api/v1/automation/rules/{id}
   */
  getAutomationRule() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.automationService.getAutomationRule(
            id,
            apiRequest.context!.tenant
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update automation rule
   * PUT /api/v1/automation/rules/{id}
   */
  updateAutomationRule() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const validatedData = await this.validateRequestData(apiRequest, updateAutomationRuleSchema);
          
          const result = await this.automationService.updateAutomationRule(
            id,
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('automation/rules', id, '/api/v1')
          };

          return createSuccessResponse(response);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete automation rule
   * DELETE /api/v1/automation/rules/{id}
   */
  deleteAutomationRule() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          
          await this.automationService.deleteAutomationRule(
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
  // AUTOMATION EXECUTION OPERATIONS
  // ============================================================================

  /**
   * List automation executions with filtering
   * GET /api/v1/automation/executions
   */
  listAutomationExecutions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery = this.validateQueryParams(apiRequest, automationExecutionsListSchema);

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.automationService.listAutomationExecutions(
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
              resource: 'automation_execution'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get automation execution by ID
   * GET /api/v1/automation/executions/{id}
   */
  getAutomationExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.automationService.getAutomationExecution(
            id,
            apiRequest.context!.tenant
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Execute automation rule manually
   * POST /api/v1/automation/rules/{id}/execute
   */
  executeAutomationRule() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const validatedData = await this.validateRequestData(apiRequest, manualExecutionSchema);
          
          // Extract rule ID from path
          const url = new URL(apiRequest.url);
          const pathParts = url.pathname.split('/');
          const rulesIndex = pathParts.findIndex(part => part === 'rules');
          const ruleId = pathParts[rulesIndex + 1];
          
          const result = await this.automationService.executeAutomationRule(
            ruleId,
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Retry failed automation execution
   * POST /api/v1/automation/executions/{id}/retry
   */
  retryAutomationExecution() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.automationService.retryAutomationExecution(
            id,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // AUTOMATION TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * List automation templates
   * GET /api/v1/automation/templates
   */
  listAutomationTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery = this.validateQueryParams(apiRequest, templatesListSchema);

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.automationService.listAutomationTemplates(
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
              resource: 'automation_template'
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get automation template by ID
   * GET /api/v1/automation/templates/{id}
   */
  getAutomationTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.automationService.getAutomationTemplate(
            id,
            apiRequest.context!.tenant
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create template from automation rule
   * POST /api/v1/automation/templates
   */
  createAutomationTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const validatedData = await this.validateRequestData(apiRequest, createTemplateFromRuleSchema);

          const result = await this.automationService.createAutomationTemplate(
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          const response = {
            ...result.data,
            _links: generateResourceLinks('automation/templates', result.data.template_id, '/api/v1')
          };

          return createSuccessResponse(response, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create automation rule from template
   * POST /api/v1/automation/templates/{id}/use
   */
  useAutomationTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const validatedData = await this.validateRequestData(apiRequest, z.object({
            variables: z.record(z.any()).optional().default({})
          }));
          
          // Extract template ID from path
          const url = new URL(apiRequest.url);
          const pathParts = url.pathname.split('/');
          const templatesIndex = pathParts.findIndex(part => part === 'templates');
          const templateId = pathParts[templatesIndex + 1];
          
          const result = await this.automationService.createRuleFromTemplate(
            templateId,
            validatedData.variables,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // ANALYTICS AND STATISTICS OPERATIONS
  // ============================================================================

  /**
   * Get automation statistics
   * GET /api/v1/automation/statistics
   */
  getAutomationStatistics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const result = await this.automationService.getAutomationStatistics(
            apiRequest.context!.tenant
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get automation performance metrics
   * GET /api/v1/automation/performance
   */
  getAutomationPerformance() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const validatedQuery = this.validateQueryParams(apiRequest, performanceMetricsRequestSchema);

          const result = await this.automationService.getPerformanceMetrics(
            validatedQuery,
            apiRequest.context!.tenant
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk update automation rule status
   * POST /api/v1/automation/rules/bulk-status
   */
  bulkUpdateStatus() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const validatedData = await this.validateRequestData(apiRequest, bulkStatusUpdateSchema);

          const result = await this.automationService.bulkUpdateStatus(
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk execute automation rules
   * POST /api/v1/automation/rules/bulk-execute
   */
  bulkExecuteRules() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'execute');

          const validatedData = await this.validateRequestData(apiRequest, bulkExecutionSchema);

          const result = await this.automationService.bulkExecute(
            validatedData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get automation rule types and categories
   * GET /api/v1/automation/meta
   */
  getAutomationMeta() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override extractIdFromPath to handle automation resources properly
   */
  protected async extractIdFromPath(req: ApiRequest): Promise<string> {
    // Check if params were passed from Next.js dynamic route
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && 'id' in params) {
        const id = params.id;
        
        // Validate UUID format (including nil UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (id && !uuidRegex.test(id)) {
          throw new ValidationError(`Invalid ID format`);
        }
        
        return id;
      }
    }
    
    // Fallback to extracting from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    
    // Find the ID after a resource name (rules, executions, templates)
    const resourceNames = ['rules', 'executions', 'templates'];
    for (const resourceName of resourceNames) {
      const resourceIndex = pathParts.findIndex(part => part === resourceName);
      if (resourceIndex !== -1 && pathParts[resourceIndex + 1]) {
        const id = pathParts[resourceIndex + 1];
        
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (id && !uuidRegex.test(id)) {
          throw new ValidationError(`Invalid ID format`);
        }
        
        return id;
      }
    }
    
    throw new ValidationError('Unable to extract ID from request path');
  }
}