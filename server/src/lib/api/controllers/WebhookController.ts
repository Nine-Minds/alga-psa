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
    super();
    this.webhookService = new WebhookService();
  }

  // ============================================================================
  // WEBHOOK CRUD OPERATIONS
  // ============================================================================

  /**
   * GET /api/v1/webhooks - List webhooks with filtering and pagination
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission('webhook', 'read'),
      withValidation(webhookListQuerySchema, 'query')
    );

    return middleware(async (req: NextRequest) => {
      const query = this.getValidatedQuery(req);
      const context = this.getServiceContext(req);
      
      const { page, limit, sort, order, ...filters } = query;
      const listOptions = { page, limit, sort, order };
      
      const result = await this.webhookService.listWebhooks(listOptions, context, filters);
      
      // Add HATEOAS links to each webhook
      const webhooksWithLinks = result.data.map(webhook => ({
        ...webhook,
        _links: getHateoasLinks('webhook', webhook.webhook_id)
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const webhook = await this.webhookService.getWebhook(id, context);
      
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
      withAuth,
      withPermission('webhook', 'create'),
      withValidation(createWebhookSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const data = await this.getValidatedBody(req) as CreateWebhookData;
      const context = this.getServiceContext(req);
      
      const webhook = await this.webhookService.createWebhook(
        data,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'update'),
      withValidation(updateWebhookSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const data = await this.getValidatedBody(req) as UpdateWebhookData;
      const context = this.getServiceContext(req);
      
      const webhook = await this.webhookService.updateWebhook(
        id,
        data,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'delete')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      await this.webhookService.deleteWebhook(id, context.tenantId, context.userId);
      
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
      withAuth,
      withPermission('webhook', 'test'),
      withValidation(webhookTestSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const testData = await this.getValidatedBody(req) as WebhookTest;
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.testWebhook(testData, context.tenantId);
      
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
      withAuth,
      withPermission('webhook', 'test'),
      withValidation(webhookTestSchema.partial(), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const testData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.testWebhook(
        { ...testData, webhook_id: id },
        context.tenantId
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const webhook = await this.webhookService.getWebhook(id, context.tenantId);
      
      if (!webhook) {
        return createErrorResponse('Webhook not found', 404);
      }

      // Validate webhook configuration
      const validationResult = await this.webhookService.validateWebhookConfiguration(
        webhook.data,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'read'),
      withValidation(z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(25),
        status: z.enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned']).optional(),
        from_date: z.string().datetime().optional(),
        to_date: z.string().datetime().optional()
      }), 'query')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const query = this.getValidatedQuery(req);
      const context = this.getServiceContext(req);
      
      const deliveries = await this.webhookService.getDeliveryHistory(
        id,
        query,
        context.tenantId
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
      withAuth,
      withPermission('webhook', 'retry')
    );

    return middleware(async (req: NextRequest) => {
      const { id, deliveryId } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.retryDelivery(
        deliveryId,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const { id, deliveryId } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const delivery = await this.webhookService.getDeliveryDetails(
        deliveryId,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const context = this.getServiceContext(req);
      
      const templates = await this.webhookService.listWebhookTemplates(context.tenantId);
      
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
      withAuth,
      withPermission('webhook', 'create_template'),
      withValidation(webhookTemplateSchema.omit({ 
        template_id: true, 
        created_at: true, 
        updated_at: true 
      }), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const templateData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const template = await this.webhookService.createWebhookTemplate(
        templateData,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'create'),
      withValidation(z.object({
        name: z.string().min(1),
        url: z.string().url(),
        custom_config: z.record(z.any()).optional()
      }), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { templateId } = this.getPathParams(req);
      const data = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const webhook = await this.webhookService.createWebhookFromTemplate(
        templateId,
        data,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'analytics'),
      withValidation(webhookAnalyticsSchema.omit({ metrics: true }), 'query')
    );

    return middleware(async (req: NextRequest) => {
      const query = this.getValidatedQuery(req) as Omit<WebhookAnalytics, 'metrics'>;
      const context = this.getServiceContext(req);
      
      const analytics = await this.webhookService.getWebhookAnalytics(
        query,
        context.tenantId
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
      withAuth,
      withPermission('webhook', 'analytics'),
      withValidation(z.object({
        date_from: z.string().datetime(),
        date_to: z.string().datetime()
      }), 'query')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const query = this.getValidatedQuery(req);
      const context = this.getServiceContext(req);
      
      const analytics = await this.webhookService.getWebhookAnalytics(
        { webhook_id: id, ...query },
        context.tenantId
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const health = await this.webhookService.getWebhookHealth(id, context.tenantId);
      
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
      withAuth,
      withPermission('webhook', 'bulk_update'),
      withValidation(bulkWebhookOperationSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const bulkData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.bulkWebhookOperation(
        bulkData,
        context.tenantId,
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const subscriptions = await this.webhookService.getWebhookSubscriptions(
        id,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'manage_subscriptions'),
      withValidation(webhookSubscriptionSchema.omit({ 
        subscription_id: true,
        webhook_id: true,
        created_at: true,
        updated_at: true,
        tenant: true
      }), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const subscriptionData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const subscription = await this.webhookService.createWebhookSubscription(
        id,
        subscriptionData,
        context.tenantId,
        context.userId
      );
      
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
      withAuth,
      withPermission('webhook', 'test'),
      withValidation(z.object({
        sample_event: webhookEventSchema,
        transformation: z.object({
          template: z.string().optional(),
          include_fields: z.array(z.string()).optional(),
          exclude_fields: z.array(z.string()).optional(),
          custom_fields: z.record(z.any()).optional()
        }).optional()
      }), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const { sample_event, transformation } = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.testPayloadTransformation(
        id,
        sample_event,
        transformation,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'test'),
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
      }), 'body')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const { sample_event, filter } = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.testEventFilter(
        id,
        sample_event,
        filter,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'verify'),
      withValidation(webhookSignatureSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const signatureData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.verifyWebhookSignature(
        signatureData,
        context.tenantId
      );
      
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
      withAuth,
      withPermission('webhook', 'manage_security')
    );

    return middleware(async (req: NextRequest) => {
      const { id } = this.getPathParams(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.rotateWebhookSecret(
        id,
        context.tenantId,
        context.userId
      );
      
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
      withAuth,
      withPermission('webhook', 'read'),
      withValidation(webhookSearchSchema, 'query')
    );

    return middleware(async (req: NextRequest) => {
      const searchParams = this.getValidatedQuery(req);
      const context = this.getServiceContext(req);
      
      const results = await this.webhookService.searchWebhooks(
        searchParams,
        context.tenantId
      );
      
      const response = createApiResponse({
        data: results.data.map(webhook => ({
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
      withAuth,
      withPermission('webhook', 'export'),
      withValidation(z.object({
        format: z.enum(['json', 'csv', 'yaml']).default('json'),
        include_secrets: z.boolean().default(false),
        webhook_ids: z.array(z.string().uuid()).optional()
      }), 'query')
    );

    return middleware(async (req: NextRequest) => {
      const exportParams = this.getValidatedQuery(req);
      const context = this.getServiceContext(req);
      
      const exportData = await this.webhookService.exportWebhooks(
        exportParams,
        context.tenantId,
        context.userId
      );
      
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
      withAuth,
      withPermission('webhook', 'read')
    );

    return middleware(async (req: NextRequest) => {
      const context = this.getServiceContext(req);
      
      const events = await this.webhookService.listAvailableEvents(context.tenantId);
      
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
      withAuth,
      withPermission('webhook', 'trigger'),
      withValidation(webhookEventSchema, 'body')
    );

    return middleware(async (req: NextRequest) => {
      const eventData = await this.getValidatedBody(req);
      const context = this.getServiceContext(req);
      
      const result = await this.webhookService.triggerWebhookEvent(
        eventData,
        context.tenantId,
        context.userId
      );
      
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