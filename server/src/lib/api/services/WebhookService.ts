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
  WebhookSubscription,
  WebhookAnalytics,
  WebhookEvent,
  WebhookSecurityConfig,
  RetryConfig,
  EventFilter,
  PayloadTransformation
} from '../schemas/webhookSchemas';
import { DatabaseService } from './DatabaseService';
import { PaginatedResponse, SuccessResponse } from '../../types/api';
import { validateTenantAccess } from '@alga-psa/validation';
import { EventBusService } from './EventBusService';
import { AuditLogService } from './AuditLogService';
import { 
  generateComprehensiveLinks, 
  generateCollectionLinks, 
  addHateoasLinks 
} from '../utils/responseHelpers';

export class WebhookService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private auditLog: AuditLogService
  ) {}

  // ============================================================================
  // WEBHOOK CRUD OPERATIONS
  // ============================================================================

  async createWebhook(
      data: CreateWebhookData,
      tenantId: string,
      userId?: string
    ): Promise<SuccessResponse<WebhookResponse>> {
      await validateTenantAccess(tenantId);
  
      // Validate webhook URL
      await this.validateWebhookUrl(data.url);
  
      // Validate event types
      for (const eventType of data.event_types) {
        await this.validateEventType(eventType);
      }
  
      const webhookId = crypto.randomUUID();
      const now = new Date().toISOString();
  
      const webhook = {
        webhook_id: webhookId,
        tenant: tenantId,
        created_at: now,
        updated_at: now,
        total_deliveries: 0,
        successful_deliveries: 0,
        failed_deliveries: 0,
        last_delivery_at: null,
        last_success_at: null,
        last_failure_at: null,
        ...data
      };
  
      await this.db.insert('webhooks', webhook);
  
      // Create subscriptions for each event type
      for (const eventType of data.event_types) {
        await this.createEventSubscription(webhookId, eventType, tenantId);
      }
  
      // Publish event
      await this.eventBus.publish('webhook.created', {
        webhookId,
        tenantId,
        webhookName: data.name,
        eventTypes: data.event_types,
        userId
      });
  
      // Audit log
      await this.auditLog.log({
        action: 'webhook_created',
        entityType: 'webhook',
        entityId: webhookId,
        userId,
        tenantId,
        changes: webhook
      });
  
      // Generate HATEOAS links
      const links = generateComprehensiveLinks('webhooks', webhookId, '/api/v1', {
        crudActions: ['read', 'update', 'delete'],
        customActions: {
          test: { method: 'POST', path: 'test' },
          deliveries: { method: 'GET', path: 'deliveries' },
          analytics: { method: 'GET', path: 'analytics' }
        },
        relationships: {
          subscriptions: { resource: 'webhook-subscriptions', many: true },
          templates: { resource: 'webhook-templates', many: true }
        }
      });
  
      const responseData = {
        ...webhook,
        last_delivery_at: webhook.last_delivery_at || undefined,
        last_failure_at: webhook.last_failure_at || undefined,
        last_success_at: webhook.last_success_at || undefined,
        description: webhook.description || null
      } as unknown as WebhookResponse;
  
      return {
        success: true,
        data: addHateoasLinks(responseData, links)
      };
    }


  async getWebhook(
      webhookId: string,
      tenantId: string
    ): Promise<SuccessResponse<WebhookResponse>> {
      await validateTenantAccess(tenantId);
  
      const webhook = await this.db.findOne('webhooks', {
        webhook_id: webhookId,
        tenant: tenantId
      });
  
      if (!webhook) {
        throw new Error('Webhook not found');
      }
  
      // Get recent delivery statistics
      const recentStats = await this.getRecentDeliveryStats(webhookId);
      webhook.recent_stats = recentStats;
  
      // Generate HATEOAS links
      const links = generateComprehensiveLinks('webhooks', webhookId, '/api/v1', {
        crudActions: ['read', 'update', 'delete'],
        customActions: {
          test: { method: 'POST', path: 'test' },
          deliveries: { method: 'GET', path: 'deliveries' },
          analytics: { method: 'GET', path: 'analytics' },
          retry: { method: 'POST', path: 'retry' }
        },
        relationships: {
          subscriptions: { resource: 'webhook-subscriptions', many: true },
          templates: { resource: 'webhook-templates', many: true }
        }
      });
  
      const responseData = {
        ...webhook,
        last_delivery_at: webhook.last_delivery_at || undefined,
        last_failure_at: webhook.last_failure_at || undefined,
        last_success_at: webhook.last_success_at || undefined,
        description: webhook.description || null
      } as unknown as WebhookResponse;
  
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

    const existing = await this.db.findOne('webhooks', {
      webhook_id: webhookId,
      tenant: tenantId
    });

    if (!existing) {
      throw new Error('Webhook not found');
    }

    // Validate URL if being updated
    if (data.url) {
      await this.validateWebhookUrl(data.url);
    }

    // Validate event types if being updated
    if (data.event_types) {
      for (const eventType of data.event_types) {
        await this.validateEventType(eventType);
      }
    }

    const updated = {
      ...existing,
      ...data,
      updated_at: new Date().toISOString()
    };

    await this.db.update('webhooks',
      { webhook_id: webhookId, tenant: tenantId },
      updated
    );

    // Update event subscriptions if event types changed
    if (data.event_types) {
      await this.updateEventSubscriptions(webhookId, data.event_types, tenantId);
    }

    // Publish event
    await this.eventBus.publish('webhook.updated', {
      webhookId,
      tenantId,
      webhookName: updated.name,
      changes: data,
      userId
    });

    // Audit log
    await this.auditLog.log({
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
      data: updated as WebhookResponse
    };
  }

  async deleteWebhook(
    webhookId: string,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{}>> {
    await validateTenantAccess(tenantId);

    const existing = await this.db.findOne('webhooks', {
      webhook_id: webhookId,
      tenant: tenantId
    });

    if (!existing) {
      throw new Error('Webhook not found');
    }

    // Delete webhook and related data
    await Promise.all([
      this.db.delete('webhooks', { webhook_id: webhookId, tenant: tenantId }),
      this.db.delete('webhook_subscriptions', { webhook_id: webhookId }),
      this.db.delete('webhook_deliveries', { webhook_id: webhookId })
    ]);

    // Publish event
    await this.eventBus.publish('webhook.deleted', {
      webhookId,
      tenantId,
      webhookName: existing.name,
      userId
    });

    // Audit log
    await this.auditLog.log({
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
    
        const conditions = { tenant: tenantId, ...filters };
        const offset = (page - 1) * limit;
    
        const [webhooks, total] = await Promise.all([
          this.db.findMany('webhooks', conditions, {
            limit,
            offset,
            orderBy: { created_at: 'desc' }
          }),
          this.db.count('webhooks', conditions)
        ]);
  
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
              analytics: { method: 'GET', path: 'analytics' }
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



  // ============================================================================
  // WEBHOOK TESTING
  // ============================================================================

  async testWebhook(
    data: WebhookTest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookTestResult>> {
    await validateTenantAccess(tenantId);

    let webhook;
    let testUrl = data.override_url;

    if (data.webhook_id) {
      webhook = await this.db.findOne('webhooks', {
        webhook_id: data.webhook_id,
        tenant: tenantId
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      testUrl = testUrl || webhook.url;
    }

    if (!testUrl) {
      throw new Error('No webhook URL provided for testing');
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
        headers: webhook?.custom_headers || {},
        payload: testPayload,
        security: webhook?.security,
        retry_config: webhook?.retry_config,
        verify_ssl: webhook?.verify_ssl !== false
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

      // Store test result
      await this.db.insert('webhook_test_results', {
        ...testResult,
        webhook_id: data.webhook_id,
        tenant: tenantId,
        tested_by: userId
      });

      // Publish event
      await this.eventBus.publish('webhook.tested', {
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
    } catch (error) {
      const testResult: WebhookTestResult = {
        test_id: testId,
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
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
    const webhook = await this.db.findOne('webhooks', {
      webhook_id: webhookId,
      tenant: tenantId
    });

    if (!webhook || !webhook.is_active) {
      return;
    }

    // Check if event matches webhook filters
    if (!this.eventMatchesFilters(event, webhook.event_filter)) {
      return;
    }

    // Apply rate limiting
    if (webhook.rate_limit?.enabled) {
      const rateLimitOk = await this.checkRateLimit(webhookId, webhook.rate_limit);
      if (!rateLimitOk) {
        return;
      }
    }

    const deliveryId = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      // Transform payload if needed
      const payload = await this.transformPayload(event, webhook.payload_transformation);

      // Perform delivery
      const deliveryResult = await this.performWebhookDelivery({
        webhook_id: webhookId,
        url: webhook.url,
        method: webhook.method,
        headers: webhook.custom_headers || {},
        payload,
        security: webhook.security,
        retry_config: webhook.retry_config,
        verify_ssl: webhook.verify_ssl
      });

      // Record delivery
      const delivery: WebhookDelivery = {
        delivery_id: deliveryId,
        webhook_id: webhookId,
        event_id: event.event_id,
        event_type: event.event_type,
        request_url: webhook.url,
        request_method: webhook.method,
        request_headers: webhook.custom_headers,
        request_body: JSON.stringify(payload),
        response_status: deliveryResult.status_code,
        response_headers: deliveryResult.response_headers,
        response_body: deliveryResult.response_body,
        status: deliveryResult.success ? 'delivered' : 'failed',
        attempt_number: 1,
        duration_ms: deliveryResult.duration_ms,
        error_message: deliveryResult.error_message,
        attempted_at: now,
        completed_at: now,
        next_retry_at: undefined,
        tenant: tenantId
      };

      await this.db.insert('webhook_deliveries', delivery);

      // Update webhook statistics
      await this.updateWebhookStats(webhookId, deliveryResult.success);

      // Schedule retry if failed and retry is configured
      if (!deliveryResult.success && webhook.retry_config?.max_attempts > 1) {
        await this.scheduleRetry(delivery, webhook.retry_config);
      }

      // Publish delivery event
      await this.eventBus.publish('webhook.delivered', {
        webhookId,
        deliveryId,
        tenantId,
        success: deliveryResult.success,
        eventType: event.event_type
      });

    } catch (error) {
      // Record failed delivery
      const delivery: WebhookDelivery = {
        delivery_id: deliveryId,
        webhook_id: webhookId,
        event_id: event.event_id,
        event_type: event.event_type,
        request_url: webhook.url,
        request_method: webhook.method,
        status: 'failed',
        attempt_number: 1,
        error_message: error instanceof Error ? error.message : String(error),
        attempted_at: now,
        completed_at: now,
        next_retry_at: undefined,
        tenant: tenantId
      };

      await this.db.insert('webhook_deliveries', delivery);
      await this.updateWebhookStats(webhookId, false);
    }
  }

  async retryDelivery(
    deliveryId: string,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookDelivery>> {
    await validateTenantAccess(tenantId);

    const delivery = await this.db.findOne('webhook_deliveries', {
      delivery_id: deliveryId,
      tenant: tenantId
    });

    if (!delivery) {
      throw new Error('Webhook delivery not found');
    }

    if (delivery.status === 'delivered') {
      throw new Error('Cannot retry successful delivery');
    }

    const webhook = await this.db.findOne('webhooks', {
      webhook_id: delivery.webhook_id,
      tenant: tenantId
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    // Perform retry
    try {
      const payload = JSON.parse(delivery.request_body || '{}');
      
      const deliveryResult = await this.performWebhookDelivery({
        webhook_id: delivery.webhook_id,
        url: webhook.url,
        method: webhook.method,
        headers: webhook.custom_headers || {},
        payload,
        security: webhook.security,
        retry_config: webhook.retry_config,
        verify_ssl: webhook.verify_ssl
      });

      // Update delivery record
      const updated = {
        ...delivery,
        response_status: deliveryResult.status_code,
        response_headers: deliveryResult.response_headers,
        response_body: deliveryResult.response_body,
        status: deliveryResult.success ? 'delivered' : 'failed',
        attempt_number: delivery.attempt_number + 1,
        duration_ms: deliveryResult.duration_ms,
        error_message: deliveryResult.error_message,
        completed_at: new Date().toISOString(),
        next_retry_at: null
      };

      await this.db.update('webhook_deliveries',
        { delivery_id: deliveryId, tenant: tenantId },
        updated
      );

      // Update webhook statistics
      await this.updateWebhookStats(delivery.webhook_id, deliveryResult.success);

      // Publish event
      await this.eventBus.publish('webhook.delivery.retried', {
        webhookId: delivery.webhook_id,
        deliveryId,
        tenantId,
        success: deliveryResult.success,
        userId
      });

      return {
        success: true,
        data: updated as WebhookDelivery
      };
    } catch (error) {
      throw new Error(`Retry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getDeliveryHistory(
      webhookId: string,
      tenantId: string,
      page: number = 1,
      limit: number = 25
    ): Promise<PaginatedResponse<WebhookDelivery>> {
      await validateTenantAccess(tenantId);
  
      const conditions = { webhook_id: webhookId, tenant: tenantId };
      const offset = (page - 1) * limit;
  
      const [deliveries, total] = await Promise.all([
        this.db.findMany('webhook_deliveries', conditions, {
          limit,
          offset,
          orderBy: { attempted_at: 'desc' }
        }),
        this.db.count('webhook_deliveries', conditions)
      ]);
  
      return {
        success: true,
        data: deliveries as WebhookDelivery[],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }


  // ============================================================================
  // WEBHOOK TEMPLATES
  // ============================================================================

  async createWebhookTemplate(
    template: Omit<WebhookTemplate, 'template_id' | 'created_at' | 'updated_at'>,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookTemplate>> {
    await validateTenantAccess(tenantId);

    const templateId = crypto.randomUUID();
    const now = new Date().toISOString();

    const webhookTemplate: WebhookTemplate = {
      template_id: templateId,
      created_at: now,
      updated_at: now,
      tenant: tenantId,
      ...template
    };

    await this.db.insert('webhook_templates', webhookTemplate);

    // Audit log
    await this.auditLog.log({
      action: 'webhook_template_created',
      entityType: 'webhook_template',
      entityId: templateId,
      userId,
      tenantId,
      changes: webhookTemplate
    });

    return {
      success: true,
      data: webhookTemplate
    };
  }

  async listWebhookTemplates(
    tenantId: string,
    category?: string
  ): Promise<SuccessResponse<WebhookTemplate[]>> {
    await validateTenantAccess(tenantId);

    const conditions: any = {
      $or: [
        { tenant: tenantId },
        { is_system_template: true }
      ]
    };

    if (category) {
      conditions.category = category;
    }

    const templates = await this.db.findMany('webhook_templates', conditions, {
      orderBy: { name: 'asc' }
    });

    return {
      success: true,
      data: templates as WebhookTemplate[]
    };
  }

  async createWebhookFromTemplate(
    templateId: string,
    customization: Partial<CreateWebhookData>,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<WebhookResponse>> {
    await validateTenantAccess(tenantId);

    const template = await this.db.findOne('webhook_templates', {
      template_id: templateId,
      $or: [
        { tenant: tenantId },
        { is_system_template: true }
      ]
    });

    if (!template) {
      throw new Error('Webhook template not found');
    }

    // Merge template configuration with customization
    const webhookData = {
      name: String(customization.name || template.name),
      description: customization.description || template.description || null,
      url: String(customization.url || template.default_config?.url_template || ''),
      method: (customization.method || template.default_config?.method || 'POST') as any,
      event_types: (customization.event_types || template.supported_events || []) as any,
      custom_headers: {
        ...template.default_config.headers,
        ...customization.custom_headers
      },
      security: customization.security || {
        type: template.default_config.security_type || 'none',
        header_name: 'Authorization',
        algorithm: 'sha256' as const,
        signature_header: 'X-Signature'
      },
      ...customization
    };

    return await this.createWebhook(webhookData as CreateWebhookData, tenantId, userId);
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
              throw new Error('Test event type required for test operation');
            }
            await this.testWebhook({ 
              webhook_id: webhookId, 
              test_event_type: testEventType as any 
            }, tenantId, userId);
            break;
        }
        results.processed++;
      } catch (error) {
        results.errors.push(`${webhookId}: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error('Webhook URL must use HTTP or HTTPS protocol');
      }
    } catch (error) {
      throw new Error('Invalid webhook URL format');
    }
  }

  private async validateEventType(eventType: string): Promise<void> {
    // Implementation would validate against supported event types
    const supportedEvents = [
      'ticket.created', 'ticket.updated', 'project.created', 
      // ... other supported events
    ];

    if (!supportedEvents.includes(eventType)) {
      throw new Error(`Unsupported event type: ${eventType}`);
    }
  }

  private async createEventSubscription(
    webhookId: string,
    eventType: string,
    tenantId: string
  ): Promise<void> {
    const subscription: WebhookSubscription = {
      subscription_id: crypto.randomUUID(),
      webhook_id: webhookId,
      entity_type: eventType.split('.')[0],
      event_types: [eventType as any],
      is_active: true,
      expires_at: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tenant: tenantId
    };

    await this.db.insert('webhook_subscriptions', subscription);
  }

  private async updateEventSubscriptions(
    webhookId: string,
    eventTypes: string[],
    tenantId: string
  ): Promise<void> {
    // Remove existing subscriptions
    await this.db.delete('webhook_subscriptions', { webhook_id: webhookId });

    // Create new subscriptions
    for (const eventType of eventTypes) {
      await this.createEventSubscription(webhookId, eventType, tenantId);
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
    duration_ms?: number;
  }> {
    // Mock implementation - would make actual HTTP request
    const startTime = Date.now();
    
    try {
      // Simulate HTTP request
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return {
        success: true,
        status_code: 200,
        response_headers: { 'content-type': 'application/json' },
        response_body: '{"success": true}',
        duration_ms: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      };
    }
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
    webhookId: string,
    rateLimit: { requests_per_minute: number; burst_limit?: number }
  ): Promise<boolean> {
    // Implementation would check rate limits
    // This is a simplified version
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

    const recentDeliveries = await this.db.count('webhook_deliveries', {
      webhook_id: webhookId,
      attempted_at: { gte: oneMinuteAgo.toISOString() }
    });

    return recentDeliveries < rateLimit.requests_per_minute;
  }

  private async updateWebhookStats(webhookId: string, success: boolean): Promise<void> {
    const updates: any = {
      total_deliveries: { $inc: 1 },
      last_delivery_at: new Date().toISOString()
    };

    if (success) {
      updates.successful_deliveries = { $inc: 1 };
      updates.last_success_at = new Date().toISOString();
    } else {
      updates.failed_deliveries = { $inc: 1 };
      updates.last_failure_at = new Date().toISOString();
    }

    await this.db.update('webhooks', { webhook_id: webhookId }, updates);
  }

  private async scheduleRetry(
    delivery: WebhookDelivery,
    retryConfig: RetryConfig
  ): Promise<void> {
    // Implementation would schedule retry based on strategy
    const nextRetryAt = this.calculateNextRetryTime(
      delivery.attempt_number,
      retryConfig
    );

    await this.db.update('webhook_deliveries',
      { delivery_id: delivery.delivery_id },
      {
        status: 'retrying',
        next_retry_at: nextRetryAt.toISOString()
      }
    );
  }

  private calculateNextRetryTime(
    attemptNumber: number,
    retryConfig: RetryConfig
  ): Date {
    const { strategy, initial_delay, max_delay, backoff_multiplier } = retryConfig || {
      strategy: 'exponential_backoff' as const,
      initial_delay: 1000,
      max_delay: 300000,
      backoff_multiplier: 2
    };
    
    let delay = initial_delay;

    switch (strategy) {
      case 'exponential_backoff':
        delay = initial_delay * Math.pow(backoff_multiplier, attemptNumber - 1);
        break;
      case 'linear_backoff':
        delay = initial_delay * attemptNumber;
        break;
      case 'fixed_interval':
        delay = initial_delay;
        break;
    }

    delay = Math.min(delay, max_delay);
    return new Date(Date.now() + delay);
  }

  private async getRecentDeliveryStats(webhookId: string): Promise<any> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, successful, failed] = await Promise.all([
      this.db.count('webhook_deliveries', {
        webhook_id: webhookId,
        attempted_at: { gte: twentyFourHoursAgo.toISOString() }
      }),
      this.db.count('webhook_deliveries', {
        webhook_id: webhookId,
        status: 'delivered',
        attempted_at: { gte: twentyFourHoursAgo.toISOString() }
      }),
      this.db.count('webhook_deliveries', {
        webhook_id: webhookId,
        status: 'failed',
        attempted_at: { gte: twentyFourHoursAgo.toISOString() }
      })
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
    const conditions: any = { tenant: tenantId };
    
    if (webhookId) {
      conditions.webhook_id = webhookId;
    }

    conditions.attempted_at = {
      gte: dateFrom,
      lte: dateTo
    };

    const [totalDeliveries, successfulDeliveries, failedDeliveries] = await Promise.all([
      this.db.count('webhook_deliveries', conditions),
      this.db.count('webhook_deliveries', { ...conditions, status: 'delivered' }),
      this.db.count('webhook_deliveries', { ...conditions, status: 'failed' })
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