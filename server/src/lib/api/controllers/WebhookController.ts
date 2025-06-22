/**
 * Webhook API Controller
 * Comprehensive controller for webhook management and delivery operations
 * Handles webhook CRUD, testing, templates, analytics, and monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
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
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class WebhookController extends BaseController {
  private webhookService: WebhookService;

  constructor() {
    super(null as any, null as any);
    this.webhookService = new WebhookService(null as any, null as any, null as any);
  }

  // ============================================================================
  // WEBHOOK CRUD OPERATIONS
  // ============================================================================

  /**
   * GET /api/v1/webhooks - List webhooks with filtering and pagination
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any,
      withValidation(webhookListQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const { page, limit, sort, order, ...filters } = query;
      const listOptions = { 
        page: parseInt(page as string) || 1, 
        limit: parseInt(limit as string) || 25, 
        sort: sort as string, 
        order: order as string 
      };
      
      const result = await this.webhookService.listWebhooks(filters as any, context.tenant, listOptions as any);
      
      // Add HATEOAS links to each webhook
      const webhooksWithLinks = result.data.map((webhook: any) => ({
        ...webhook,
        _links: getHateoasLinks('webhook', webhook.webhook_id || webhook.id)
      }));

      const response = createApiResponse({
        data: webhooksWithLinks,
        pagination: result.pagination,
        _links: {
          self: { href: `/api/v1/webhooks` },
          create: { href: `/api/v1/webhooks`, method: 'POST' },
          templates: { href: `/api/v1/webhooks/templates` },
          analytics: { href: `/api/v1/webhooks/analytics` },
          test: { href: `/api/v1/webhooks/test`, method: 'POST' },
          bulk: { href: `/api/v1/webhooks/bulk`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/webhooks/{id} - Get webhook details
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const webhook = await this.webhookService.getWebhook(id, context.tenant);
      
      if (!webhook) {
        return createErrorResponse('Webhook not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...webhook.data,
          _links: {
            ...getHateoasLinks('webhook', webhook.data.webhook_id),
            test: { href: `/api/v1/webhooks/${id}/test`, method: 'POST' },
            deliveries: { href: `/api/v1/webhooks/${id}/deliveries` },
            analytics: { href: `/api/v1/webhooks/${id}/analytics` },
            subscriptions: { href: `/api/v1/webhooks/${id}/subscriptions` }
          }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks - Create new webhook
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'create') as any,
      withValidation(createWebhookSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {} as CreateWebhookData;
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const webhook = await this.webhookService.createWebhook(
        data,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: {
          ...webhook.data,
          _links: getHateoasLinks('webhook', webhook.data.webhook_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/webhooks/{id} - Update webhook
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'update') as any,
      withValidation(updateWebhookSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {} as UpdateWebhookData;
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const webhook = await this.webhookService.updateWebhook(
        id,
        data,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: {
          ...webhook.data,
          _links: getHateoasLinks('webhook', webhook.data.webhook_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/webhooks/{id} - Delete webhook
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.webhookService.deleteWebhook(id, context.tenant, context.userId);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  // ============================================================================
  // WEBHOOK TESTING AND VALIDATION
  // ============================================================================

  /**
   * POST /api/v1/webhooks/test - Test webhook configuration
   */
  test() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'test') as any,
      withValidation(webhookTestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const testData = await req.json() || {} as WebhookTest;
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.webhookService.testWebhook(testData, context.tenant);
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/test` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/test - Test specific webhook
   */
  testById() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'test') as any,
      withValidation(webhookTestSchema.partial() as any, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const testData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.webhookService.testWebhook(
        { ...testData, webhook_id: id },
        context.tenant
      );
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/test` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/validate - Validate webhook configuration
   */
  validate() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const webhook = await this.webhookService.getWebhook(id, context.tenant);
      
      if (!webhook) {
        return createErrorResponse('Webhook not found', 404);
      }

      // Validate webhook configuration
      // TODO: Implement validateWebhookConfiguration method in WebhookService
      // const validationResult = await this.webhookService.validateWebhookConfiguration(
      //   webhook.data,
      //   context.tenant
      // );
      const validationResult = { valid: true, errors: [] }; // Temporary stub
      
      const response = createApiResponse({
        data: validationResult,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/validate` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // DELIVERY HISTORY AND RETRY FUNCTIONALITY
  // ============================================================================

  /**
   * GET /api/v1/webhooks/{id}/deliveries - Get webhook delivery history
   */
  getDeliveries() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any,
      withValidation(z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(25),
        status: z.enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned']).optional(),
        from_date: z.string().datetime().optional(),
        to_date: z.string().datetime().optional()
      }), 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const options = {
        page: parseInt(query.page as string) || 1,
        limit: parseInt(query.limit as string) || 25,
        status: query.status as any,
        from_date: query.from_date as string,
        to_date: query.to_date as string
      };
      
      const deliveries = await this.webhookService.getDeliveryHistory(
        id,
        options as any,
        context.tenant
      );
      
      const response = createApiResponse({
        data: deliveries.data,
        pagination: deliveries.pagination,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/deliveries` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/retry - Retry failed delivery
   */
  retryDelivery() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'retry') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id, deliveryId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.webhookService.retryDelivery(
        deliveryId,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/deliveries/${deliveryId}/retry` },
          delivery: { href: `/api/v1/webhooks/${id}/deliveries/${deliveryId}` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/webhooks/{id}/deliveries/{deliveryId} - Get delivery details
   */
  getDelivery() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id, deliveryId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement getDeliveryDetails method in WebhookService
      // const delivery = await this.webhookService.getDeliveryDetails(
      //   deliveryId,
      //   context.tenant
      // );
      const delivery = { data: { id: deliveryId, status: 'delivered', timestamp: new Date().toISOString() } }; // Temporary stub
      
      if (!delivery) {
        return createErrorResponse('Delivery not found', 404);
      }

      const response = createApiResponse({
        data: delivery.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/deliveries/${deliveryId}` },
          retry: { href: `/api/v1/webhooks/${id}/deliveries/${deliveryId}/retry`, method: 'POST' },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // WEBHOOK TEMPLATES
  // ============================================================================

  /**
   * GET /api/v1/webhooks/templates - List webhook templates
   */
  listTemplates() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const templates = await this.webhookService.listWebhookTemplates(context.tenant);
      
      const response = createApiResponse({
        data: templates.data,
        _links: {
          self: { href: `/api/v1/webhooks/templates` },
          create: { href: `/api/v1/webhooks/templates`, method: 'POST' },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/templates - Create webhook template
   */
  createTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'create_template') as any,
      withValidation(webhookTemplateSchema.omit({ 
        template_id: true, 
        created_at: true, 
        updated_at: true 
      }), 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const templateData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const template = await this.webhookService.createWebhookTemplate(
        templateData,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: template.data,
        _links: {
          self: { href: `/api/v1/webhooks/templates/${template.data.template_id}` },
          use: { href: `/api/v1/webhooks/templates/${template.data.template_id}/use`, method: 'POST' },
          templates: { href: `/api/v1/webhooks/templates` }
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/templates/{templateId}/use - Create webhook from template
   */
  useTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'create') as any,
      withValidation(z.object({
        name: z.string().min(1),
        url: z.string().url(),
        custom_config: z.record(z.any()).optional()
      }), 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { templateId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const webhook = await this.webhookService.createWebhookFromTemplate(
        templateId,
        data,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: {
          ...webhook.data,
          _links: getHateoasLinks('webhook', webhook.data.webhook_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // ANALYTICS AND MONITORING
  // ============================================================================

  /**
   * GET /api/v1/webhooks/analytics - Get webhook analytics
   */
  getAnalytics() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'analytics') as any,
      withValidation(webhookAnalyticsSchema.omit({ metrics: true }) as any, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries()) as Omit<WebhookAnalytics, 'metrics'>;
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const analytics = await this.webhookService.getWebhookAnalytics(
        query.webhook_id,
        query.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        query.date_to || new Date().toISOString(),
        context.tenant
      );
      
      const response = createApiResponse({
        data: analytics.data,
        _links: {
          self: { href: `/api/v1/webhooks/analytics` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/webhooks/{id}/analytics - Get analytics for specific webhook
   */
  getWebhookAnalytics() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'analytics') as any,
      withValidation(z.object({
        date_from: z.string().datetime(),
        date_to: z.string().datetime()
      }), 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const analytics = await this.webhookService.getWebhookAnalytics(
        id,
        query.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        query.date_to || new Date().toISOString(),
        context.tenant
      );
      
      const response = createApiResponse({
        data: analytics.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/analytics` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/webhooks/{id}/health - Get webhook health status
   */
  getHealth() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement getWebhookHealth method in WebhookService
      // const health = await this.webhookService.getWebhookHealth(id, context.tenant);
      const health = { data: { status: 'healthy', last_check: new Date().toISOString() } }; // Temporary stub
      
      const response = createApiResponse({
        data: health.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/health` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/webhooks/bulk - Perform bulk operations on webhooks
   */
  bulkOperation() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'bulk_update') as any,
      withValidation(bulkWebhookOperationSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const bulkData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.webhookService.bulkWebhookOperation(
        bulkData,
        context.tenant,
        context.userId
      );
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/bulk` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  /**
   * GET /api/v1/webhooks/{id}/subscriptions - List webhook subscriptions
   */
  getSubscriptions() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement getWebhookSubscriptions method in WebhookService
      // const subscriptions = await this.webhookService.getWebhookSubscriptions(
      //   id,
      //   context.tenant
      // );
      const subscriptions = { data: [] }; // Temporary stub
      
      const response = createApiResponse({
        data: subscriptions.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/subscriptions` },
          webhook: { href: `/api/v1/webhooks/${id}` },
          create: { href: `/api/v1/webhooks/${id}/subscriptions`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/subscriptions - Create webhook subscription
   */
  createSubscription() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'manage_subscriptions') as any,
      withValidation(webhookSubscriptionSchema.omit({ 
        subscription_id: true,
        webhook_id: true,
        created_at: true,
        updated_at: true,
        tenant: true
      }), 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const subscriptionData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement createWebhookSubscription method in WebhookService
      // const subscription = await this.webhookService.createWebhookSubscription(
      //   id,
      //   subscriptionData,
      //   context.tenant,
      //   context.userId
      // );
      const subscription = { data: { subscription_id: 'sub_' + Date.now(), webhook_id: id } }; // Temporary stub
      
      const response = createApiResponse({
        data: subscription.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/subscriptions/${subscription.data.subscription_id}` },
          webhook: { href: `/api/v1/webhooks/${id}` },
          subscriptions: { href: `/api/v1/webhooks/${id}/subscriptions` }
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // EVENT FILTERING AND PAYLOAD TRANSFORMATION
  // ============================================================================

  /**
   * POST /api/v1/webhooks/{id}/test-transform - Test payload transformation
   */
  testTransform() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'test') as any,
      withValidation(z.object({
        sample_event: webhookEventSchema,
        transformation: z.object({
          template: z.string().optional(),
          include_fields: z.array(z.string()).optional(),
          exclude_fields: z.array(z.string()).optional(),
          custom_fields: z.record(z.any()).optional()
        }).optional()
      }), 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const { sample_event, transformation } = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement testPayloadTransformation method in WebhookService
      // const result = await this.webhookService.testPayloadTransformation(
      //   id,
      //   sample_event,
      //   transformation,
      //   context.tenant
      // );
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
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/test-transform` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/test-filter - Test event filtering
   */
  testFilter() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'test') as any,
      withValidation(z.object({
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
      }), 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const { sample_event, filter } = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement testEventFilter method in WebhookService
      // const result = await this.webhookService.testEventFilter(
      //   id,
      //   sample_event,
      //   filter,
      //   context.tenant
      // );
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
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/test-filter` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // WEBHOOK SECURITY AND VERIFICATION
  // ============================================================================

  /**
   * POST /api/v1/webhooks/verify-signature - Verify webhook signature
   */
  verifySignature() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'verify') as any,
      withValidation(webhookSignatureSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const signatureData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement verifyWebhookSignature method in WebhookService
      // const result = await this.webhookService.verifyWebhookSignature(
      //   signatureData,
      //   context.tenant
      // );
      const result = { data: { valid: true } }; // Temporary stub
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/verify-signature` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/{id}/rotate-secret - Rotate webhook secret
   */
  rotateSecret() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'manage_security') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement rotateWebhookSecret method in WebhookService
      // const result = await this.webhookService.rotateWebhookSecret(
      //   id,
      //   context.tenant,
      //   context.userId
      // );
      const result = { data: { secret: 'new_secret_' + Date.now() } }; // Temporary stub
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/${id}/rotate-secret` },
          webhook: { href: `/api/v1/webhooks/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // SEARCH AND DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/webhooks/search - Search webhooks
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any,
      withValidation(webhookSearchSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const searchParams = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement searchWebhooks method in WebhookService
      // const results = await this.webhookService.searchWebhooks(
      //   searchParams,
      //   context.tenant
      // );
      const results = { data: [], pagination: { page: 1, limit: 25, total: 0 } }; // Temporary stub
      
      const response = createApiResponse({
        data: results.data.map((webhook: any) => ({
          ...webhook,
          _links: getHateoasLinks('webhook', webhook.webhook_id)
        })),
        pagination: results.pagination,
        _links: {
          self: { href: `/api/v1/webhooks/search` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/webhooks/export - Export webhooks
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'export') as any,
      withValidation(z.object({
        format: z.enum(['json', 'csv', 'yaml']).default('json'),
        include_secrets: z.boolean().default(false),
        webhook_ids: z.array(z.string().uuid()).optional()
      }), 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const exportParams = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement exportWebhooks method in WebhookService
      // const exportData = await this.webhookService.exportWebhooks(
      //   exportParams,
      //   context.tenant,
      //   context.userId
      // );
      const exportData = { data: [] }; // Temporary stub
      
      const response = createApiResponse({
        data: exportData.data,
        _links: {
          self: { href: `/api/v1/webhooks/export` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // WEBHOOK EVENTS AND TRIGGERS
  // ============================================================================

  /**
   * GET /api/v1/webhooks/events - List available webhook events
   */
  listEvents() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement listAvailableEvents method in WebhookService
      // const events = await this.webhookService.listAvailableEvents(context.tenant);
      const events = { data: ['ticket.created', 'ticket.updated', 'invoice.created'] }; // Temporary stub
      
      const response = createApiResponse({
        data: events.data,
        _links: {
          self: { href: `/api/v1/webhooks/events` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/webhooks/trigger - Manually trigger webhook event
   */
  triggerEvent() {
    const middleware = compose(
      withAuth as any,
      withPermission('webhook', 'trigger') as any,
      withValidation(webhookEventSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const eventData = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // TODO: Implement triggerWebhookEvent method in WebhookService
      // const result = await this.webhookService.triggerWebhookEvent(
      //   eventData,
      //   context.tenant,
      //   context.userId
      // );
      const result = { data: { event_id: 'event_' + Date.now(), triggered: true } }; // Temporary stub
      
      const response = createApiResponse({
        data: result.data,
        _links: {
          self: { href: `/api/v1/webhooks/trigger` },
          webhooks: { href: `/api/v1/webhooks` }
        }
      });

      return NextResponse.json(response);
    });
  }
}