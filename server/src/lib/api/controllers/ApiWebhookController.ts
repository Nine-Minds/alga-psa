/**
 * API Webhook Controller V2
 * Simplified version with proper API key authentication for webhook management
 */

import { NextRequest, NextResponse } from 'next/server';
import { WebhookService } from '../services/WebhookService';
import { 
  createWebhookSchema,
  updateWebhookSchema,
  webhookListQuerySchema,
  webhookTestSchema,
  webhookFilterSchema,
  bulkWebhookOperationSchema,
  webhookSearchSchema,
  webhookAnalyticsSchema,
  webhookSubscriptionSchema,
  webhookTemplateSchema,
  webhookEventSchema,
  webhookSignatureSchema,
  CreateWebhookData,
  UpdateWebhookData,
  WebhookTest,
  WebhookFilterData,
  WebhookAnalytics
} from '../schemas/webhookSchemas';
import { z } from 'zod';
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
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiWebhookController {
  private webhookService: WebhookService;

  constructor() {
    this.webhookService = new WebhookService(
      undefined as any, // DatabaseService - would be injected
      undefined as any, // EventBusService - would be injected  
      undefined as any  // AuditLogService - would be injected
    );
  }

  /**
   * Authenticate request and set context
   */
  private async authenticate(req: NextRequest): Promise<ApiRequest> {
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }

    // Extract tenant ID from header
    let tenantId = req.headers.get('x-tenant-id');
    let keyRecord;

    if (tenantId) {
      // If tenant is provided, validate key for that specific tenant
      keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
    } else {
      // Otherwise, search across all tenants
      keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (keyRecord) {
        tenantId = keyRecord.tenant;
      }
    }
    
    if (!keyRecord) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Get user within tenant context
    const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Create extended request with context
    const apiRequest = req as ApiRequest;
    apiRequest.context = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant,
      user
    };

    return apiRequest;
  }

  /**
   * Check permissions
   */
  private async checkPermission(req: ApiRequest, action: string): Promise<void> {
    if (!req.context?.user) {
      throw new UnauthorizedError('User context required');
    }

    // Get a connection within the current tenant context
    const knex = await getConnection(req.context.tenant);
    
    const hasAccess = await hasPermission(req.context.user, 'webhook', action, knex);
    if (!hasAccess) {
      throw new ForbiddenError(`Permission denied: Cannot ${action} webhook`);
    }
  }

  /**
   * Extract ID from request path
   */
  private async extractIdFromPath(req: ApiRequest): Promise<string> {
    // Check if params were passed from Next.js dynamic route
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && 'id' in params) {
        const id = params.id;
        
        // Validate UUID format (including nil UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (id && !uuidRegex.test(id)) {
          throw new ValidationError(`Invalid webhook ID format`);
        }
        
        return id;
      }
    }
    
    // Fallback to extracting from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const resourceIndex = pathParts.findIndex(part => part === 'webhooks');
    const id = pathParts[resourceIndex + 1] || '';
    
    // Validate UUID format (including nil UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (id && !uuidRegex.test(id)) {
      throw new ValidationError(`Invalid webhook ID format`);
    }
    
    return id;
  }

  // ============================================================================
  // WEBHOOK CRUD OPERATIONS
  // ============================================================================

  /**
   * List webhooks with filtering and pagination
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'created_at';
          const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

          // Extract filters
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            if (!['page', 'limit', 'sort', 'order'].includes(key)) {
              query[key] = value;
            }
          });

          const result = await this.webhookService.listWebhooks(query, apiRequest.context!.tenant, page, limit);
          
          return createPaginatedResponse(
            result.data,
            result.pagination.total,
            page,
            limit,
            { sort, order, filters: query }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get webhook details
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const webhook = await this.webhookService.getWebhook(id, apiRequest.context!.tenant);
          
          if (!webhook) {
            throw new NotFoundError('Webhook not found');
          }

          return createSuccessResponse(webhook.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create new webhook
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Validate data
          const data = await this.validateData(apiRequest, createWebhookSchema);

          try {
            const webhook = await this.webhookService.createWebhook(
              data,
              apiRequest.context!.tenant,
              apiRequest.context!.userId
            );
            
            return createSuccessResponse(webhook.data, 201);
          } catch (error: any) {
            if (error.message && error.message.includes('already exists')) {
              throw new ConflictError(error.message);
            }
            throw error;
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update webhook
   */
  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, updateWebhookSchema);

          const webhook = await this.webhookService.updateWebhook(
            id,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );
          
          if (!webhook) {
            throw new NotFoundError('Webhook not found');
          }
          
          return createSuccessResponse(webhook.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete webhook
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
          
          // Check if webhook exists
          const webhook = await this.webhookService.getWebhook(id, apiRequest.context!.tenant);
          if (!webhook) {
            throw new NotFoundError('Webhook not found');
          }
          
          await this.webhookService.deleteWebhook(id, apiRequest.context!.tenant, apiRequest.context!.userId);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WEBHOOK TESTING AND VALIDATION
  // ============================================================================

  /**
   * Test webhook configuration
   */
  test() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          // Validate data
          const testData = await this.validateData(apiRequest, webhookTestSchema);
          
          const result = await this.webhookService.testWebhook(testData, apiRequest.context!.tenant);
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Test specific webhook
   */
  testById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          const id = await this.extractIdFromPath(apiRequest);
          const testData = await this.validateData(apiRequest, webhookTestSchema.partial());
          
          const result = await this.webhookService.testWebhook(
            { ...testData, webhook_id: id },
            apiRequest.context!.tenant
          );
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Validate specific webhook configuration
   */
  validate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const webhook = await this.webhookService.getWebhook(id, apiRequest.context!.tenant);
          
          if (!webhook) {
            throw new NotFoundError('Webhook not found');
          }

          // Validate webhook configuration
          // TODO: Implement validateWebhookConfiguration method in WebhookService
          const validationResult = { valid: true, errors: [] }; // Temporary stub
          
          return createSuccessResponse(validationResult);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Validate webhook configuration (generic - from payload)
   */
  validateGeneric() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const webhookConfig = await this.validateData(apiRequest, createWebhookSchema.partial());

          // Validate webhook configuration from payload
          // TODO: Implement validateWebhookConfiguration method in WebhookService
          const validationResult = { valid: true, errors: [], configuration: webhookConfig }; // Temporary stub
          
          return createSuccessResponse(validationResult);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // DELIVERY HISTORY AND RETRY FUNCTIONALITY
  // ============================================================================

  /**
   * Get webhook delivery history
   */
  getDeliveries() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const query = this.validateQuery(apiRequest, z.object({
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(25),
            status: z.enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned']).optional(),
            from_date: z.string().datetime().optional(),
            to_date: z.string().datetime().optional()
          }));
          
          const options = {
            page: query.page || 1,
            limit: query.limit || 25,
            status: query.status,
            from_date: query.from_date,
            to_date: query.to_date
          };
          
          const deliveries = await this.webhookService.getDeliveryHistory(
            id,
            apiRequest.context!.tenant,
            options.page,
            options.limit
          );
          
          return createPaginatedResponse(
            deliveries.data,
            deliveries.pagination.total,
            deliveries.pagination.page,
            deliveries.pagination.limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Retry failed delivery
   */
  retryDelivery() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'retry');

          const url = new URL(apiRequest.url);
          const pathParts = url.pathname.split('/');
          const deliveryId = pathParts[pathParts.length - 2]; // delivery_id is before 'retry'
          
          const result = await this.webhookService.retryDelivery(
            deliveryId,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get delivery details
   */
  getDelivery() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const pathParts = url.pathname.split('/');
          const deliveryId = pathParts[pathParts.length - 1]; // Last part is delivery_id
          
          // TODO: Implement getDeliveryDetails method in WebhookService
          const delivery = { data: { id: deliveryId, status: 'delivered', timestamp: new Date().toISOString() } }; // Temporary stub
          
          if (!delivery) {
            throw new NotFoundError('Delivery not found');
          }

          return createSuccessResponse(delivery.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WEBHOOK TEMPLATES
  // ============================================================================

  /**
   * List webhook templates
   */
  listTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const templates = await this.webhookService.listWebhookTemplates(apiRequest.context!.tenant);
          
          return createSuccessResponse(templates.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create webhook template
   */
  createTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions - webhook templates require system settings permissions
          await this.checkPermission(apiRequest, 'system_settings');

          const templateData = await this.validateData(apiRequest, webhookTemplateSchema.omit({ 
            template_id: true, 
            created_at: true, 
            updated_at: true 
          }));
          
          const template = await this.webhookService.createWebhookTemplate(
            templateData,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );
          
          return createSuccessResponse(template.data, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create webhook from template
   */
  useTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          const url = new URL(apiRequest.url);
          const pathParts = url.pathname.split('/');
          const templateIndex = pathParts.findIndex(part => part === 'templates');
          const templateId = pathParts[templateIndex + 1];

          const data = await this.validateData(apiRequest, z.object({
            name: z.string().min(1),
            url: z.string().url(),
            custom_config: z.record(z.any()).optional()
          }));
          
          const webhook = await this.webhookService.createWebhookFromTemplate(
            templateId,
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );
          
          return createSuccessResponse(webhook.data, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // ANALYTICS AND MONITORING
  // ============================================================================

  /**
   * Get webhook analytics
   */
  getAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'analytics');

          const query = this.validateQuery(apiRequest, webhookAnalyticsSchema.omit({ metrics: true }));
          
          const analytics = await this.webhookService.getWebhookAnalytics(
            query.webhook_id,
            query.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            query.date_to || new Date().toISOString(),
            apiRequest.context!.tenant
          );
          
          return createSuccessResponse(analytics.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get analytics for specific webhook
   */
  getWebhookAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'analytics');

          const id = await this.extractIdFromPath(apiRequest);
          const query = this.validateQuery(apiRequest, z.object({
            date_from: z.string().datetime(),
            date_to: z.string().datetime()
          }));
          
          const analytics = await this.webhookService.getWebhookAnalytics(
            id,
            query.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            query.date_to || new Date().toISOString(),
            apiRequest.context!.tenant
          );
          
          return createSuccessResponse(analytics.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get webhook health status for specific webhook
   */
  getHealth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          // TODO: Implement getWebhookHealth method in WebhookService
          const health = { data: { status: 'healthy', last_check: new Date().toISOString() } }; // Temporary stub
          
          return createSuccessResponse(health.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get system-wide webhook health status
   */
  getSystemHealth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // TODO: Implement getSystemWebhookHealth method in WebhookService
          const health = { 
            data: { 
              status: 'healthy', 
              total_webhooks: 0, 
              active_webhooks: 0,
              failed_webhooks: 0,
              last_check: new Date().toISOString() 
            } 
          }; // Temporary stub
          
          return createSuccessResponse(health.data);
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
   * Perform bulk operations on webhooks
   */
  bulkOperation() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'bulk_update');

          const bulkData = await this.validateData(apiRequest, bulkWebhookOperationSchema);
          
          const result = await this.webhookService.bulkWebhookOperation(
            bulkData.operation,
            bulkData.webhook_ids,
            apiRequest.context!.tenant,
            bulkData.test_event_type,
            apiRequest.context!.userId
          );
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  /**
   * List webhook subscriptions
   */
  getSubscriptions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          // TODO: Implement getWebhookSubscriptions method in WebhookService
          const subscriptions = { data: [] }; // Temporary stub
          
          return createSuccessResponse(subscriptions.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create webhook subscription
   */
  createSubscription() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'manage_subscriptions');

          const id = await this.extractIdFromPath(apiRequest);
          const subscriptionData = await this.validateData(apiRequest, webhookSubscriptionSchema.omit({ 
            subscription_id: true,
            webhook_id: true,
            created_at: true,
            updated_at: true,
            tenant: true
          }));
          
          // TODO: Implement createWebhookSubscription method in WebhookService
          const subscription = { data: { subscription_id: 'sub_' + Date.now(), webhook_id: id } }; // Temporary stub
          
          return createSuccessResponse(subscription.data, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // EVENT FILTERING AND PAYLOAD TRANSFORMATION
  // ============================================================================

  /**
   * Test payload transformation for specific webhook
   */
  testTransform() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          const id = await this.extractIdFromPath(apiRequest);
          const { sample_event, transformation } = await this.validateData(apiRequest, z.object({
            sample_event: webhookEventSchema,
            transformation: z.object({
              template: z.string().optional(),
              include_fields: z.array(z.string()).optional(),
              exclude_fields: z.array(z.string()).optional(),
              custom_fields: z.record(z.any()).optional()
            }).optional()
          }));
          
          // TODO: Implement testPayloadTransformation method in WebhookService
          const result = {
            data: {
              original_payload: sample_event,
              transformed_payload: {
                ...sample_event,
                ...(transformation?.custom_fields || {}),
                _transformation_applied: true,
                _timestamp: new Date().toISOString()
              },
              transformation_success: true,
              applied_transformations: {
                template_used: transformation?.template || null,
                fields_included: transformation?.include_fields || [],
                fields_excluded: transformation?.exclude_fields || [],
                custom_fields_added: Object.keys(transformation?.custom_fields || {})
              }
            }
          }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Test payload transformation (webhook-agnostic)
   */
  testTransformGeneric() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          const { sample_event, transformation } = await this.validateData(apiRequest, z.object({
            sample_event: webhookEventSchema,
            transformation: z.object({
              template: z.string().optional(),
              include_fields: z.array(z.string()).optional(),
              exclude_fields: z.array(z.string()).optional(),
              custom_fields: z.record(z.any()).optional()
            }).optional()
          }));
          
          // TODO: Implement testPayloadTransformation method in WebhookService
          const result = {
            data: {
              original_payload: sample_event,
              transformed_payload: {
                ...sample_event,
                ...(transformation?.custom_fields || {}),
                _transformation_applied: true,
                _timestamp: new Date().toISOString()
              },
              transformation_success: true,
              applied_transformations: {
                template_used: transformation?.template || null,
                fields_included: transformation?.include_fields || [],
                fields_excluded: transformation?.exclude_fields || [],
                custom_fields_added: Object.keys(transformation?.custom_fields || {})
              }
            }
          }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Test event filtering for specific webhook
   */
  testFilter() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          const id = await this.extractIdFromPath(apiRequest);
          const { sample_event, filter } = await this.validateData(apiRequest, z.object({
            sample_event: webhookEventSchema,
            filter: z.object({
              entity_types: z.array(z.string()).optional(),
              entity_ids: z.array(z.string().uuid()).optional(),
              conditions: z.array(z.object({
                field: z.string(),
                operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in']),
                value: z.any()
              })).optional(),
              tags: z.array(z.string()).optional()
            }).optional()
          }));
          
          // TODO: Implement testEventFilter method in WebhookService
          const result = {
            data: {
              event_matches_filter: true,
              filter_applied: {
                entity_types: filter?.entity_types || [],
                entity_ids: filter?.entity_ids || [],
                conditions_met: (filter?.conditions || []).map((condition: any) => ({
                  field: condition.field,
                  operator: condition.operator,
                  value: condition.value,
                  result: true
                })),
                tags_matched: filter?.tags || []
              },
              sample_event: sample_event,
              filter_evaluation: {
                passed: true,
                reason: 'Event matches all filter criteria',
                matched_conditions: filter?.conditions?.length || 0,
                total_conditions: filter?.conditions?.length || 0
              }
            }
          }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Test event filtering (webhook-agnostic)
   */
  testFilterGeneric() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'test');

          const { sample_event, filter } = await this.validateData(apiRequest, z.object({
            sample_event: webhookEventSchema,
            filter: z.object({
              entity_types: z.array(z.string()).optional(),
              entity_ids: z.array(z.string().uuid()).optional(),
              conditions: z.array(z.object({
                field: z.string(),
                operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in']),
                value: z.any()
              })).optional(),
              tags: z.array(z.string()).optional()
            }).optional()
          }));
          
          // TODO: Implement testEventFilter method in WebhookService
          const result = {
            data: {
              event_matches_filter: true,
              filter_applied: {
                entity_types: filter?.entity_types || [],
                entity_ids: filter?.entity_ids || [],
                conditions_met: (filter?.conditions || []).map((condition: any) => ({
                  field: condition.field,
                  operator: condition.operator,
                  value: condition.value,
                  result: true
                })),
                tags_matched: filter?.tags || []
              },
              sample_event: sample_event,
              filter_evaluation: {
                passed: true,
                reason: 'Event matches all filter criteria',
                matched_conditions: filter?.conditions?.length || 0,
                total_conditions: filter?.conditions?.length || 0
              }
            }
          }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WEBHOOK SECURITY AND VERIFICATION
  // ============================================================================

  /**
   * Verify webhook signature
   */
  verifySignature() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'verify');

          const signatureData = await this.validateData(apiRequest, webhookSignatureSchema);
          
          // TODO: Implement verifyWebhookSignature method in WebhookService
          const result = { data: { valid: true } }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Rotate webhook secret
   */
  rotateSecret() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'manage_security');

          const id = await this.extractIdFromPath(apiRequest);
          
          // TODO: Implement rotateWebhookSecret method in WebhookService
          const result = { data: { secret: 'new_secret_' + Date.now() } }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // SEARCH AND DISCOVERY
  // ============================================================================

  /**
   * Search webhooks
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

          const searchParams = this.validateQuery(apiRequest, webhookSearchSchema);
          
          // TODO: Implement searchWebhooks method in WebhookService
          const results = { data: [], pagination: { page: 1, limit: 25, total: 0 } }; // Temporary stub
          
          return createPaginatedResponse(
            results.data,
            results.pagination.total,
            results.pagination.page,
            results.pagination.limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export webhooks
   */
  export() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'export');

          const exportParams = this.validateQuery(apiRequest, z.object({
            format: z.enum(['json', 'csv', 'yaml']).default('json'),
            include_secrets: z.boolean().default(false),
            webhook_ids: z.array(z.string().uuid()).optional()
          }));
          
          // TODO: Implement exportWebhooks method in WebhookService
          const exportData = { data: [] }; // Temporary stub
          
          return createSuccessResponse(exportData.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // WEBHOOK EVENTS AND TRIGGERS
  // ============================================================================

  /**
   * List available webhook events
   */
  listEvents() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // TODO: Implement listAvailableEvents method in WebhookService
          const events = { data: ['ticket.created', 'ticket.updated', 'invoice.created'] }; // Temporary stub
          
          return createSuccessResponse(events.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Manually trigger webhook event
   */
  triggerEvent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'trigger');

          const eventData = await this.validateData(apiRequest, webhookEventSchema);
          
          // TODO: Implement triggerWebhookEvent method in WebhookService
          const result = { data: { event_id: 'event_' + Date.now(), triggered: true } }; // Temporary stub
          
          return createSuccessResponse(result.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Validate request data
   */
  private async validateData(req: ApiRequest, schema: z.ZodSchema): Promise<any> {
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

  /**
   * Validate query parameters
   */
  private validateQuery(req: ApiRequest, schema: z.ZodSchema): any {
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
}
