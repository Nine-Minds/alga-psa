/**
 * Webhook Service
 * Comprehensive service layer for webhook management and delivery
 * Handles webhook CRUD, delivery tracking, templates, subscriptions, and analytics
 */

import {
  CreateWebhookData,
  UpdateWebhookData,
  WebhookResponse,
  WebhookFilterData,
  WebhookDelivery,
  WebhookTest,
  WebhookTestResult,
  WebhookTemplate,
  WebhookAnalytics,
  WebhookEvent,
  WebhookSecurityConfig,
  RetryConfig,
  EventFilter,
  PayloadTransformation
} from '../schemas/webhookSchemas';
import { disallowedEventTypes } from '../../webhooks/eventRegistry';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import { PaginatedResponse, SuccessResponse } from '../../types/api';
import { validateTenantAccess } from '@alga-psa/validation';
import { EventBusService } from './EventBusService';
import { AuditLogService } from './AuditLogService';
import { 
  generateComprehensiveLinks, 
  generateCollectionLinks, 
  addHateoasLinks 
} from '../utils/responseHelpers';
import { randomBytes } from 'node:crypto';
import { webhookModel, type ListWebhooksFilters, type WebhookDeliveryRecord, type WebhookRecord } from '../../webhooks/webhookModel';
import { enqueueDeliveryRetry, retryFailedDeliveriesForWebhook } from '../../webhooks/deliveryRetry';
import { performWebhookDeliveryRequest } from '../../webhooks/delivery';
import { computeBackoff } from '../../webhooks/backoff';
import {
  ConflictError,
  NotFoundError,
  NotImplementedError,
  UnprocessableEntityError,
  ValidationError,
} from '../middleware/apiMiddleware';

export class WebhookService {
  // Persistence is webhookModel (tenant-scoped). The event bus and audit log are optional collaborators:
  // the REST controller does not wire them, so every use below is guarded.
  constructor(
    private eventBus?: EventBusService,
    private auditLog?: AuditLogService
  ) {}

  /** Map a webhookModel record to the snake_case REST representation. */
  private toWebhookResponse(webhook: WebhookRecord): WebhookResponse {
    return {
      webhook_id: webhook.webhookId,
      tenant: webhook.tenant,
      name: webhook.name,
      description: null,
      url: webhook.url,
      method: webhook.method,
      event_types: webhook.eventTypes,
      custom_headers: webhook.customHeaders,
      event_filter: webhook.eventFilter,
      payload_fields: webhook.payloadFields,
      retry_config: webhook.retryConfig,
      is_active: webhook.isActive,
      verify_ssl: webhook.verifySsl,
      rate_limit: {
        enabled: true,
        requests_per_minute: webhook.rateLimitPerMin,
        burst_limit: null,
      },
      total_deliveries: webhook.totalDeliveries,
      successful_deliveries: webhook.successfulDeliveries,
      failed_deliveries: webhook.failedDeliveries,
      last_delivery_at: webhook.lastDeliveryAt ?? undefined,
      last_success_at: webhook.lastSuccessAt ?? undefined,
      last_failure_at: webhook.lastFailureAt ?? undefined,
      created_at: webhook.createdAt,
      updated_at: webhook.updatedAt,
    } as unknown as WebhookResponse;
  }

  /** Map a webhookModel delivery record to the snake_case REST representation. */
  private toDeliveryResponse(delivery: WebhookDeliveryRecord, webhook: WebhookRecord): WebhookDelivery {
    return {
      delivery_id: delivery.deliveryId,
      webhook_id: delivery.webhookId,
      event_id: delivery.eventId,
      event_type: delivery.eventType,
      request_url: webhook.url,
      request_method: webhook.method,
      request_headers: delivery.requestHeaders ?? undefined,
      request_body:
        delivery.requestBody === null || delivery.requestBody === undefined
          ? undefined
          : typeof delivery.requestBody === 'string'
            ? delivery.requestBody
            : JSON.stringify(delivery.requestBody),
      response_status: delivery.responseStatusCode ?? undefined,
      response_headers: delivery.responseHeaders ?? undefined,
      response_body: delivery.responseBody ?? undefined,
      status: delivery.status,
      attempt_number: delivery.attemptNumber,
      duration_ms: delivery.durationMs ?? undefined,
      error_message: delivery.errorMessage ?? undefined,
      attempted_at: delivery.attemptedAt,
      completed_at: delivery.completedAt ?? undefined,
      next_retry_at: delivery.nextRetryAt ?? undefined,
      tenant: delivery.tenant,
    } as unknown as WebhookDelivery;
  }

  // ============================================================================
  // WEBHOOK CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a webhook through the same persistence path as the settings UI:
   * webhookModel.insert stores the row and the signing secret (vault), and the
   * generated secret is returned once in the response, as rotate does.
   * Delivery requires that secret (webhookModel.getSigningSecret).
   */
  async createWebhook(
    data: CreateWebhookData,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookResponse & { signing_secret: string }>> {
    await validateTenantAccess(tenantId);

    if (!userId) {
      throw new ValidationError('A user is required to create a webhook');
    }

    // Validate webhook URL
    await this.validateWebhookUrl(data.url);

    // Validate event types
    this.assertEventTypesAllowed(data.event_types, []);

    const signingSecret = randomBytes(32).toString('base64url');
    const created = await webhookModel.insert({
      tenant: tenantId,
      name: data.name,
      url: data.url,
      method: data.method,
      eventTypes: data.event_types,
      customHeaders: data.custom_headers ?? null,
      eventFilter: (data.event_filter as Record<string, unknown> | undefined) ?? null,
      payloadFields: data.payload_fields ?? null,
      signingSecret,
      retryConfig: (data.retry_config as Record<string, unknown> | undefined) ?? null,
      verifySsl: data.verify_ssl,
      rateLimitPerMin: data.rate_limit?.requests_per_minute,
      isActive: data.is_active,
      createdByUserId: userId,
    });

    // Generate HATEOAS links
    const links = generateComprehensiveLinks('webhooks', created.webhookId, '/api/v1', {
      crudActions: ['read', 'update', 'delete'],
      customActions: {
        test: { method: 'POST', path: 'test' },
        deliveries: { method: 'GET', path: 'deliveries' },
        analytics: { method: 'GET', path: 'analytics' },
        'retry-failed': { method: 'POST', path: 'retry-failed' }
      },
      relationships: {
        subscriptions: { resource: 'webhook-subscriptions', many: true },
        templates: { resource: 'webhook-templates', many: true }
      }
    });

    const responseData = {
      webhook_id: created.webhookId,
      tenant: created.tenant,
      name: created.name,
      description: data.description ?? null,
      url: created.url,
      method: created.method,
      event_types: created.eventTypes,
      custom_headers: created.customHeaders,
      event_filter: created.eventFilter,
      payload_fields: created.payloadFields,
      retry_config: created.retryConfig,
      is_active: created.isActive,
      verify_ssl: created.verifySsl,
      total_deliveries: created.totalDeliveries,
      successful_deliveries: created.successfulDeliveries,
      failed_deliveries: created.failedDeliveries,
      created_at: created.createdAt,
      updated_at: created.updatedAt,
      // Shown once, like rotate. Never returned by read endpoints.
      signing_secret: signingSecret,
    } as unknown as WebhookResponse & { signing_secret: string };

    return {
      success: true,
      data: addHateoasLinks(responseData, links) as WebhookResponse & { signing_secret: string }
    };
  }

  async getWebhook(
      webhookId: string,
      tenantId: string
    ): Promise<SuccessResponse<WebhookResponse>> {
      await validateTenantAccess(tenantId);
  
      const record = await webhookModel.getById(webhookId, tenantId);
  
      if (!record) {
        throw new NotFoundError('Webhook not found');
      }
  
      // Get recent delivery statistics
      const recentStats = await this.getRecentDeliveryStats(webhookId, tenantId);
      const webhook = { ...this.toWebhookResponse(record), recent_stats: recentStats };
  
      // Generate HATEOAS links
      const links = generateComprehensiveLinks('webhooks', webhookId, '/api/v1', {
        crudActions: ['read', 'update', 'delete'],
        customActions: {
          test: { method: 'POST', path: 'test' },
          deliveries: { method: 'GET', path: 'deliveries' },
          analytics: { method: 'GET', path: 'analytics' },
          'retry-failed': { method: 'POST', path: 'retry-failed' }
        },
        relationships: {
          subscriptions: { resource: 'webhook-subscriptions', many: true },
          templates: { resource: 'webhook-templates', many: true }
        }
      });
  
      const responseData = webhook as unknown as WebhookResponse;
  
      return {
        success: true,
        data: addHateoasLinks(responseData, links)
      };
    }


  async updateWebhook(
    webhookId: string,
    data: UpdateWebhookData,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookResponse>> {
    await validateTenantAccess(tenantId);

    const existing = await webhookModel.getById(webhookId, tenantId);

    if (!existing) {
      throw new NotFoundError('Webhook not found');
    }

    // Validate URL if being updated
    if (data.url) {
      await this.validateWebhookUrl(data.url);
    }

    // Validate event types if being updated
    // Legacy names already stored on the webhook pass through; names newly added must be registered.
    // (createUpdateSchema erases the inferred field types, hence the explicit string[] view.)
    const requestedEventTypes = data.event_types as string[] | undefined;
    if (requestedEventTypes) {
      this.assertEventTypesAllowed(
        requestedEventTypes,
        existing.eventTypes
      );
    }

    // Event subscriptions are the event_types column on the webhook row, so one tenant-scoped update covers them.
    // Fields without a column (description, security, payload_format, ...) are not persisted.
    const updated = await webhookModel.update(webhookId, tenantId, {
      name: data.name,
      url: data.url,
      method: data.method,
      eventTypes: requestedEventTypes,
      customHeaders: data.custom_headers,
      eventFilter: data.event_filter as Record<string, unknown> | undefined,
      payloadFields: data.payload_fields,
      retryConfig: data.retry_config as Record<string, unknown> | undefined,
      verifySsl: data.verify_ssl,
      rateLimitPerMin: data.rate_limit?.requests_per_minute,
      isActive: data.is_active,
    });

    if (!updated) {
      throw new NotFoundError('Webhook not found');
    }

    // Publish event
    await this.eventBus?.publish('webhook.updated', {
      webhookId,
      tenantId,
      webhookName: updated.name,
      changes: data,
      userId
    });

    // Audit log
    await this.auditLog?.log({
      action: 'webhook_updated',
      entityType: 'webhook',
      entityId: webhookId,
      userId,
      tenantId,
      changes: data,
      previousValues: existing
    });

    return {
      success: true,
      data: this.toWebhookResponse(updated)
    };
  }

  async deleteWebhook(
    webhookId: string,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{}>> {
    await validateTenantAccess(tenantId);

    // webhookModel.delete is tenant-scoped; it removes the row (deliveries go with it through the
    // (tenant, webhook_id) ON DELETE CASCADE foreign key) and the vault signing secret.
    const existing = await webhookModel.delete(webhookId, tenantId);

    if (!existing) {
      throw new NotFoundError('Webhook not found');
    }

    // Publish event
    await this.eventBus?.publish('webhook.deleted', {
      webhookId,
      tenantId,
      webhookName: existing.name,
      userId
    });

    // Audit log
    await this.auditLog?.log({
      action: 'webhook_deleted',
      entityType: 'webhook',
      entityId: webhookId,
      userId,
      tenantId,
      previousValues: existing
    });

    return { success: true, data: {} };
  }

  async listWebhooks(
        filters: WebhookFilterData,
        tenantId: string,
        page: number = 1,
        limit: number = 25
      ): Promise<PaginatedResponse<WebhookResponse>> {
        await validateTenantAccess(tenantId);
    
        const result = await webhookModel.listPage(tenantId, {
          page,
          limit,
          filters: this.toModelFilters(filters)
        });
        const webhooks = result.data.map(record => this.toWebhookResponse(record));
        const total = result.total;
        // The model clamps page/limit; report what was applied.
        page = result.page;
        limit = result.limit;
  
        const totalPages = Math.ceil(total / limit);
        
        // Generate collection-level HATEOAS links
        const collectionLinks = generateCollectionLinks(
          'webhooks',
          '/api/v1',
          { page, limit, total, totalPages },
          filters
        );
  
        // Add individual resource links to each webhook
        const webhooksWithLinks = webhooks.map(webhook => {
          const resourceLinks = generateComprehensiveLinks('webhooks', webhook.webhook_id, '/api/v1', {
            crudActions: ['read', 'update', 'delete'],
            customActions: {
              test: { method: 'POST', path: 'test' },
              deliveries: { method: 'GET', path: 'deliveries' },
              analytics: { method: 'GET', path: 'analytics' },
              'retry-failed': { method: 'POST', path: 'retry-failed' }
            }
          });
          return addHateoasLinks(webhook as WebhookResponse, resourceLinks);
        });
    
        return {
          success: true,
          data: webhooksWithLinks,
          pagination: {
            page,
            limit,
            total,
            totalPages
          },
          _links: collectionLinks
        };
      }



  /**
   * The list route passes raw query-string values (strings), so booleans and dates are parsed here.
   * Keys that are not webhook list filters (including unknown ones) are ignored rather than becoming columns.
   */
  private toModelFilters(filters: WebhookFilterData): ListWebhooksFilters {
    const raw = filters as Record<string, unknown>;
    const toBool = (value: unknown): boolean | undefined => {
      if (value === undefined || value === '') return undefined;
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      throw new ValidationError('Invalid boolean filter value');
    };
    const toDate = (value: unknown): Date | undefined => {
      if (value === undefined || value === '') return undefined;
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        throw new ValidationError('Invalid date filter value');
      }
      return date;
    };
    const toText = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined;

    return {
      search: toText(raw.search),
      name: toText(raw.name),
      url: toText(raw.url),
      eventType: toText(raw.event_type),
      isActive: toBool(raw.is_active),
      createdFrom: toDate(raw.created_from),
      createdTo: toDate(raw.created_to),
      updatedFrom: toDate(raw.updated_from),
      updatedTo: toDate(raw.updated_to),
      lastDeliveryFrom: toDate(raw.last_delivery_from),
      lastDeliveryTo: toDate(raw.last_delivery_to),
      hasFailures: toBool(raw.has_failures),
    };
  }

  // ============================================================================
  // WEBHOOK TESTING
  // ============================================================================

  async testWebhook(
    data: WebhookTest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookTestResult>> {
    await validateTenantAccess(tenantId);

    let webhook: WebhookRecord | null = null;
    let testUrl = data.override_url;

    if (data.webhook_id) {
      webhook = await webhookModel.getById(data.webhook_id, tenantId);

      if (!webhook) {
        throw new NotFoundError('Webhook not found');
      }

      testUrl = testUrl || webhook.url;
    }

    if (!testUrl) {
      throw new ValidationError('No webhook URL provided for testing');
    }

    const testId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      // Create test payload
      const testPayload = data.test_payload || this.createTestPayload(data.test_event_type);

      // Perform webhook delivery
      const deliveryResult = await this.performWebhookDelivery({
        webhook_id: data.webhook_id || testId,
        url: testUrl,
        method: webhook?.method || 'POST',
        headers: webhook?.customHeaders || {},
        payload: testPayload,
        retry_config: webhook?.retryConfig,
        verify_ssl: webhook?.verifySsl !== false
      });

      const responseTime = Date.now() - startTime;

      const testResult: WebhookTestResult = {
        test_id: testId,
        success: deliveryResult.success,
        status_code: deliveryResult.status_code,
        response_time_ms: responseTime,
        response_body: deliveryResult.response_body,
        error_message: deliveryResult.error_message,
        tested_at: new Date().toISOString()
      };

      // Record the test as a delivery flagged is_test (as the settings UI does). A test against an
      // override URL with no stored webhook has no row to hang a delivery on, so nothing is recorded.
      if (webhook) {
        await webhookModel.recordDelivery({
          tenant: tenantId,
          webhookId: webhook.webhookId,
          eventId: testPayload.event_id ?? crypto.randomUUID(),
          eventType: 'webhook.test',
          requestHeaders: webhook.customHeaders,
          requestBody: testPayload,
          responseStatusCode: deliveryResult.status_code ?? null,
          responseHeaders: deliveryResult.response_headers ?? null,
          responseBody: deliveryResult.response_body ?? null,
          status: deliveryResult.success ? 'delivered' : 'abandoned',
          attemptNumber: 1,
          durationMs: deliveryResult.duration_ms ?? null,
          errorMessage: deliveryResult.error_message ?? null,
          isTest: true,
          completedAt: new Date(),
        });
      }

      // Publish event
      await this.eventBus?.publish('webhook.tested', {
        webhookId: data.webhook_id,
        testId,
        tenantId,
        success: testResult.success,
        userId
      });

      return {
        success: true,
        data: testResult
      };
    } catch {
      const testResult: WebhookTestResult = {
        test_id: testId,
        success: false,
        error_message: 'Webhook test failed. Check the webhook configuration and try again.',
        tested_at: new Date().toISOString()
      };

      return {
        success: true,
        data: testResult
      };
    }
  }

  // ============================================================================
  // WEBHOOK DELIVERY
  // ============================================================================

  async deliverWebhook(
    event: WebhookEvent,
    webhookId: string,
    tenantId: string
  ): Promise<void> {
    const webhook = await webhookModel.getById(webhookId, tenantId);

    if (!webhook || !webhook.isActive) {
      return;
    }

    // Check if event matches webhook filters
    if (!this.eventMatchesFilters(event, (webhook.eventFilter ?? undefined) as EventFilter | undefined)) {
      return;
    }

    // Apply the shared per-webhook outbound rate limit.
    const rateLimitOk = await this.checkRateLimit(tenantId, webhookId);
    if (!rateLimitOk) {
      return;
    }

    const deliveryId = crypto.randomUUID();
    const now = new Date();

    try {
      // Transform payload if needed (no stored transformation column: the event is sent as-is)
      const payload = await this.transformPayload(event, undefined);

      // Perform delivery
      const deliveryResult = await this.performWebhookDelivery({
        webhook_id: webhookId,
        url: webhook.url,
        method: webhook.method,
        headers: webhook.customHeaders || {},
        payload,
        retry_config: webhook.retryConfig,
        verify_ssl: webhook.verifySsl
      });

      // A failed delivery with retries configured is recorded as retrying with its next attempt time.
      const retryConfig = webhook.retryConfig as RetryConfig | null;
      const willRetry = !deliveryResult.success && (retryConfig?.max_attempts ?? 0) > 1;

      await webhookModel.recordDelivery({
        tenant: tenantId,
        deliveryId,
        webhookId,
        eventId: event.event_id,
        eventType: event.event_type,
        requestHeaders: webhook.customHeaders,
        requestBody: payload,
        responseStatusCode: deliveryResult.status_code ?? null,
        responseHeaders: deliveryResult.response_headers ?? null,
        responseBody: deliveryResult.response_body ?? null,
        status: deliveryResult.success ? 'delivered' : willRetry ? 'retrying' : 'failed',
        attemptNumber: 1,
        durationMs: deliveryResult.duration_ms ?? null,
        errorMessage: deliveryResult.error_message ?? null,
        nextRetryAt: willRetry ? this.calculateNextRetryTime(1, retryConfig as RetryConfig) : null,
        attemptedAt: now,
        completedAt: now,
      });

      // Update webhook statistics
      await this.updateWebhookStats(webhookId, tenantId, deliveryResult.success);

      // Publish delivery event
      await this.eventBus?.publish('webhook.delivered', {
        webhookId,
        deliveryId,
        tenantId,
        success: deliveryResult.success,
        eventType: event.event_type
      });

    } catch {
      // Record failed delivery
      await webhookModel.recordDelivery({
        tenant: tenantId,
        deliveryId,
        webhookId,
        eventId: event.event_id,
        eventType: event.event_type,
        status: 'failed',
        attemptNumber: 1,
        errorMessage: 'Webhook delivery failed.',
        attemptedAt: now,
        completedAt: now,
      });
      await this.updateWebhookStats(webhookId, tenantId, false);
    }
  }

  /**
   * Re-queue one delivery. The retry is handed to the delivery queue as a
   * fresh attempt (same path as the settings UI action) instead of being sent
   * inline, so rate limiting, backoff and auto-disable still apply.
   */
  async retryDelivery(
    webhookId: string,
    deliveryId: string,
    tenantId: string
  ): Promise<SuccessResponse<{
    queued: true;
    webhook_id: string;
    delivery_id: string;
    event_id: string;
  }>> {
    await validateTenantAccess(tenantId);

    const delivery = await webhookModel.getDeliveryById(tenantId, webhookId, deliveryId);

    if (!delivery) {
      throw new NotFoundError('Webhook delivery not found');
    }

    if (delivery.status === 'delivered') {
      throw new ConflictError('Cannot retry successful delivery');
    }

    if (delivery.isTest) {
      throw new ValidationError('Test deliveries cannot be retried');
    }

    const enqueued = await enqueueDeliveryRetry(delivery, tenantId);
    if (!enqueued.queued) {
      throw new UnprocessableEntityError('Stored delivery payload cannot be replayed');
    }

    return {
      success: true,
      data: {
        queued: true,
        webhook_id: webhookId,
        delivery_id: deliveryId,
        event_id: enqueued.eventId
      }
    };
  }

  /**
   * Bulk counterpart of retryDelivery: re-queues every failed/abandoned
   * delivery of a webhook, collapsing repeated attempts of one event.
   */
  async retryFailedDeliveries(
    webhookId: string,
    tenantId: string,
    options: { since?: string; limit?: number } = {}
  ): Promise<SuccessResponse<{
    queued: number;
    skipped: number;
    total_candidates: number;
    truncated: boolean;
  }>> {
    await validateTenantAccess(tenantId);

    const webhook = await webhookModel.getById(webhookId, tenantId);
    if (!webhook) {
      throw new NotFoundError('Webhook not found');
    }

    const result = await retryFailedDeliveriesForWebhook(tenantId, webhookId, {
      since: options.since ? new Date(options.since) : undefined,
      limit: options.limit
    });

    return {
      success: true,
      data: {
        queued: result.queued,
        skipped: result.skipped,
        total_candidates: result.totalCandidates,
        truncated: result.truncated
      }
    };
  }

  async getDeliveryHistory(
      webhookId: string,
      tenantId: string,
      page: number = 1,
      limit: number = 25
    ): Promise<PaginatedResponse<WebhookDelivery>> {
      await validateTenantAccess(tenantId);
  
      const webhook = await webhookModel.getById(webhookId, tenantId);
      if (!webhook) {
        throw new NotFoundError('Webhook not found');
      }

      const result = await webhookModel.listDeliveries(tenantId, webhookId, { page, limit });
  
      return {
        success: true,
        data: result.data.map(delivery => this.toDeliveryResponse(delivery, webhook)),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit)
        }
      };
    }


  // ============================================================================
  // WEBHOOK TEMPLATES
  // ============================================================================
  // There is no webhook_templates table: templates are not a persisted concept. The list is therefore
  // always empty, a template id never resolves (404), and the template create / update / delete / use
  // operations are explicitly not implemented (501).

  async createWebhookTemplate(
    _template: Omit<WebhookTemplate, 'template_id' | 'created_at' | 'updated_at'>,
    tenantId: string,
    _userId?: string
  ): Promise<SuccessResponse<WebhookTemplate>> {
    await validateTenantAccess(tenantId);

    throw new NotImplementedError('Webhook templates are not supported: there is no template storage');
  }

  async listWebhookTemplates(
    tenantId: string,
    _category?: string
  ): Promise<SuccessResponse<WebhookTemplate[]>> {
    await validateTenantAccess(tenantId);

    return {
      success: true,
      data: []
    };
  }

  async getWebhookTemplate(
    _templateId: string,
    tenantId: string
  ): Promise<SuccessResponse<WebhookTemplate>> {
    await validateTenantAccess(tenantId);

    throw new NotFoundError('Webhook template not found');
  }

  async updateWebhookTemplate(
    _templateId: string,
    _template: Partial<WebhookTemplate>,
    tenantId: string,
    _userId?: string
  ): Promise<SuccessResponse<WebhookTemplate>> {
    await validateTenantAccess(tenantId);

    throw new NotImplementedError('Webhook templates are not supported: there is no template storage');
  }

  async deleteWebhookTemplate(
    _templateId: string,
    tenantId: string,
    _userId?: string
  ): Promise<void> {
    await validateTenantAccess(tenantId);

    throw new NotImplementedError('Webhook templates are not supported: there is no template storage');
  }

  async createWebhookFromTemplate(
    _templateId: string,
    _customization: Partial<CreateWebhookData>,
    tenantId: string,
    _userId?: string
  ): Promise<SuccessResponse<WebhookResponse>> {
    await validateTenantAccess(tenantId);

    throw new NotImplementedError('Webhook templates are not supported: there is no template storage');
  }

  // ============================================================================
  // WEBHOOK ANALYTICS
  // ============================================================================

  async getWebhookAnalytics(
    webhookId: string | undefined,
    dateFrom: string,
    dateTo: string,
    tenantId: string
  ): Promise<SuccessResponse<WebhookAnalytics>> {
    await validateTenantAccess(tenantId);

    const analytics = await this.calculateWebhookAnalytics(
      webhookId,
      dateFrom,
      dateTo,
      tenantId
    );

    return {
      success: true,
      data: analytics
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  async bulkWebhookOperation(
    operation: 'activate' | 'deactivate' | 'delete' | 'test',
    webhookIds: string[],
    tenantId: string,
    testEventType?: string,
    userId?: string
  ): Promise<SuccessResponse<{ processed: number; errors: string[] }>> {
    await validateTenantAccess(tenantId);

    const results = { processed: 0, errors: [] as string[] };

    for (const webhookId of webhookIds) {
      try {
        switch (operation) {
          case 'activate':
            await this.updateWebhook(webhookId, { is_active: true }, tenantId, userId);
            break;
          case 'deactivate':
            await this.updateWebhook(webhookId, { is_active: false }, tenantId, userId);
            break;
          case 'delete':
            await this.deleteWebhook(webhookId, tenantId, userId);
            break;
          case 'test':
            if (!testEventType) {
              throw new ValidationError('Test event type required for test operation');
            }
            await this.testWebhook({ 
              webhook_id: webhookId, 
              test_event_type: testEventType as any 
            }, tenantId, userId);
            break;
        }
        results.processed++;
      } catch {
        results.errors.push(`${webhookId}: Webhook operation failed.`);
      }
    }

    return {
      success: true,
      data: results
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async validateWebhookUrl(url: string): Promise<void> {
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new ValidationError('Webhook URL must use HTTP or HTTPS protocol');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('Invalid webhook URL format');
    }
  }

  private assertEventTypesAllowed(requested: readonly string[], existing: readonly string[]): void {
    const rejected = disallowedEventTypes(requested, existing);
    if (rejected.length > 0) {
      throw new ValidationError(`Unsupported event type: ${rejected.join(', ')}`);
    }
  }

  private createTestPayload(eventType: string): any {
    // Create appropriate test payload based on event type
    return {
      event_id: crypto.randomUUID(),
      event_type: eventType,
      entity_type: eventType.split('.')[0],
      entity_id: crypto.randomUUID(),
      current_data: {
        id: crypto.randomUUID(),
        name: 'Test Entity',
        status: 'active'
      },
      occurred_at: new Date().toISOString(),
      tenant: crypto.randomUUID(),
      metadata: {
        test: true
      }
    };
  }

  private async performWebhookDelivery(config: {
    webhook_id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    payload: any;
    security?: any;
    retry_config?: any;
    verify_ssl: boolean;
  }): Promise<{
    success: boolean;
    status_code?: number;
    response_headers?: Record<string, string>;
    response_body?: string;
    error_message?: string;
    error_type?: 'dns' | 'connect' | 'ssrf' | 'tls' | 'timeout' | 'unknown';
    duration_ms?: number;
  }> {
    return performWebhookDeliveryRequest(config);
  }

  private eventMatchesFilters(event: WebhookEvent, filter?: EventFilter): boolean {
    if (!filter) return true;

    // Check entity types
    if (filter.entity_types && filter.entity_types.length > 0) {
      if (!filter.entity_types.includes(event.entity_type)) {
        return false;
      }
    }

    // Check entity IDs
    if (filter.entity_ids && filter.entity_ids.length > 0) {
      if (!filter.entity_ids.includes(event.entity_id)) {
        return false;
      }
    }

    // Check conditions
    if (filter.conditions && filter.conditions.length > 0) {
      // Implementation would evaluate conditions against event data
    }

    return true;
  }

  private async transformPayload(
    event: WebhookEvent,
    transformation?: PayloadTransformation
  ): Promise<any> {
    if (!transformation) {
      return event;
    }

    let payload: Record<string, any> = { ...event };

    // Apply field inclusion/exclusion
    if (transformation.include_fields) {
      const included: Record<string, any> = {};
      for (const field of transformation.include_fields) {
        if (payload[field] !== undefined) {
          included[field] = payload[field];
        }
      }
      payload = included;
    }

    if (transformation.exclude_fields) {
      for (const field of transformation.exclude_fields) {
        delete payload[field];
      }
    }

    // Add custom fields
    if (transformation.custom_fields) {
      Object.assign(payload, transformation.custom_fields);
    }

    // Apply template if provided
    if (transformation.template) {
      // Would use template engine like Handlebars
      // payload = applyTemplate(transformation.template, payload);
    }

    return payload;
  }

  private async checkRateLimit(
    tenantId: string,
    webhookId: string
  ): Promise<boolean> {
    const result = await TokenBucketRateLimiter.getInstance().tryConsume(
      'webhook-out',
      tenantId,
      webhookId,
    );

    return result.allowed;
  }

  private async updateWebhookStats(webhookId: string, tenantId: string, success: boolean): Promise<void> {
    await webhookModel.updateStats({ tenant: tenantId, webhookId, succeeded: success });
  }

  private calculateNextRetryTime(
    attemptNumber: number,
    _retryConfig: RetryConfig
  ): Date {
    return new Date(Date.now() + computeBackoff(attemptNumber));
  }

  private async getRecentDeliveryStats(webhookId: string, tenantId: string): Promise<any> {
    const attemptedFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, successful, failed] = await Promise.all([
      webhookModel.countDeliveries(tenantId, { webhookId, attemptedFrom }),
      webhookModel.countDeliveries(tenantId, { webhookId, attemptedFrom, status: 'delivered' }),
      webhookModel.countDeliveries(tenantId, { webhookId, attemptedFrom, status: 'failed' })
    ]);

    return {
      last_24h: {
        total_deliveries: total,
        successful_deliveries: successful,
        failed_deliveries: failed,
        success_rate: total > 0 ? (successful / total) * 100 : 0
      }
    };
  }

  private async calculateWebhookAnalytics(
    webhookId: string | undefined,
    dateFrom: string,
    dateTo: string,
    tenantId: string
  ): Promise<WebhookAnalytics> {
    // Implementation would calculate comprehensive analytics
    // This is a simplified version
    const conditions = {
      webhookId,
      attemptedFrom: new Date(dateFrom),
      attemptedTo: new Date(dateTo)
    };

    const [totalDeliveries, successfulDeliveries, failedDeliveries] = await Promise.all([
      webhookModel.countDeliveries(tenantId, conditions),
      webhookModel.countDeliveries(tenantId, { ...conditions, status: 'delivered' }),
      webhookModel.countDeliveries(tenantId, { ...conditions, status: 'failed' })
    ]);

    const successRate = totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 0;

    return {
      webhook_id: webhookId,
      date_from: dateFrom,
      date_to: dateTo,
      metrics: {
        total_deliveries: totalDeliveries,
        successful_deliveries: successfulDeliveries,
        failed_deliveries: failedDeliveries,
        success_rate: Math.round(successRate * 100) / 100,
        average_response_time: 0, // Would be calculated from actual data
        deliveries_by_status: {
          delivered: successfulDeliveries,
          failed: failedDeliveries
        },
        deliveries_by_event_type: {}, // Would be calculated from actual data
        deliveries_timeline: [], // Would be calculated from actual data
        response_time_percentiles: {
          p50: 0,
          p90: 0,
          p95: 0,
          p99: 0
        }
      }
    };
  }
}
