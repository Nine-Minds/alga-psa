import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerWebhookRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Webhooks';

  const WebhookIdParam = registry.registerSchema(
    'WebhookIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Webhook UUID from webhooks.webhook_id.'),
    }),
  );

  const WebhookDeliveryParams = registry.registerSchema(
    'WebhookDeliveryParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Webhook UUID from webhooks.webhook_id.'),
      delivery_id: zOpenApi.string().describe('Webhook delivery identifier extracted from URL path segment.'),
    }),
  );

  const WebhookListQuery = registry.registerSchema(
    'WebhookListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      name: zOpenApi.string().optional(),
      url: zOpenApi.string().optional(),
      event_type: zOpenApi.string().optional(),
      is_active: zOpenApi.enum(['true', 'false']).optional(),
      is_test_mode: zOpenApi.enum(['true', 'false']).optional(),
      payload_format: zOpenApi.enum(['json', 'xml', 'form_data', 'custom']).optional(),
      has_failures: zOpenApi.enum(['true', 'false']).optional(),
      last_delivery_from: zOpenApi.string().optional(),
      last_delivery_to: zOpenApi.string().optional(),
      delivery_rate_min: zOpenApi.string().optional(),
      delivery_rate_max: zOpenApi.string().optional(),
      query: zOpenApi.string().optional(),
    }),
  );

  const WebhookAnalyticsQuery = registry.registerSchema(
    'WebhookAnalyticsQueryV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid().optional(),
      date_from: zOpenApi.string().datetime().optional(),
      date_to: zOpenApi.string().datetime().optional(),
    }),
  );

  const WebhookDeliveryQuery = registry.registerSchema(
    'WebhookDeliveryQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      status: zOpenApi.enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned']).optional(),
      from_date: zOpenApi.string().datetime().optional(),
      to_date: zOpenApi.string().datetime().optional(),
    }),
  );

  const WebhookExportQuery = registry.registerSchema(
    'WebhookExportQueryV1',
    zOpenApi.object({
      format: zOpenApi.enum(['json', 'csv', 'yaml']).optional(),
      include_secrets: zOpenApi.enum(['true', 'false']).optional(),
      webhook_ids: zOpenApi.string().optional().describe('Controller schema expects UUID array; URL parser currently supplies raw strings.'),
    }),
  );

  const CreateWebhookBody = registry.registerSchema(
    'CreateWebhookBodyV1',
    zOpenApi.object({
      name: zOpenApi.string().min(1),
      description: zOpenApi.string().optional(),
      url: zOpenApi.string().url(),
      method: zOpenApi.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      event_types: zOpenApi.array(zOpenApi.string()).min(1),
      security: zOpenApi.record(zOpenApi.unknown()).optional(),
      payload_format: zOpenApi.enum(['json', 'xml', 'form_data', 'custom']).optional(),
      content_type: zOpenApi.string().optional(),
      custom_headers: zOpenApi.record(zOpenApi.string()).optional(),
      event_filter: zOpenApi.record(zOpenApi.unknown()).optional(),
      payload_transformation: zOpenApi.record(zOpenApi.unknown()).optional(),
      retry_config: zOpenApi.record(zOpenApi.unknown()).optional(),
      is_active: zOpenApi.boolean().optional(),
      is_test_mode: zOpenApi.boolean().optional(),
      verify_ssl: zOpenApi.boolean().optional(),
      secret_token: zOpenApi.string().optional(),
      rate_limit: zOpenApi.record(zOpenApi.unknown()).optional(),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
    }),
  );

  const WebhookTestBody = registry.registerSchema(
    'WebhookTestBodyV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid().optional(),
      test_event_type: zOpenApi.string(),
      test_payload: zOpenApi.record(zOpenApi.unknown()).optional(),
      override_url: zOpenApi.string().url().optional(),
    }),
  );

  const BulkWebhookBody = registry.registerSchema(
    'BulkWebhookBodyV1',
    zOpenApi.object({
      webhook_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(100),
      operation: zOpenApi.enum(['activate', 'deactivate', 'delete', 'test']),
      test_event_type: zOpenApi.string().optional(),
    }),
  );

  const WebhookSubscriptionBody = registry.registerSchema(
    'WebhookSubscriptionBodyV1',
    zOpenApi.object({
      entity_type: zOpenApi.string(),
      entity_id: zOpenApi.string().uuid().optional(),
      event_types: zOpenApi.array(zOpenApi.string()).min(1),
      is_active: zOpenApi.boolean().optional(),
      expires_at: zOpenApi.string().optional(),
    }),
  );

  const WebhookTemplateBody = registry.registerSchema(
    'WebhookTemplateBodyV1',
    zOpenApi.object({
      name: zOpenApi.string(),
      description: zOpenApi.string().optional(),
      category: zOpenApi.string(),
      default_config: zOpenApi.record(zOpenApi.unknown()),
      required_fields: zOpenApi.array(zOpenApi.string()).optional(),
      supported_events: zOpenApi.array(zOpenApi.string()).optional(),
      is_system_template: zOpenApi.boolean().optional(),
    }),
  );

  const WebhookTemplateCreateBody = registry.registerSchema(
    'WebhookTemplateCreateBodyV1',
    zOpenApi.object({
      name: zOpenApi.string().min(1),
      url: zOpenApi.string().url(),
      custom_config: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const WebhookTransformBody = registry.registerSchema(
    'WebhookTransformBodyV1',
    zOpenApi.object({
      sample_event: zOpenApi.record(zOpenApi.unknown()),
      transformation: zOpenApi
        .object({
          template: zOpenApi.string().optional(),
          include_fields: zOpenApi.array(zOpenApi.string()).optional(),
          exclude_fields: zOpenApi.array(zOpenApi.string()).optional(),
          custom_fields: zOpenApi.record(zOpenApi.unknown()).optional(),
        })
        .optional(),
    }),
  );

  const WebhookFilterTestBody = registry.registerSchema(
    'WebhookFilterTestBodyV1',
    zOpenApi.object({
      sample_event: zOpenApi.record(zOpenApi.unknown()),
      filter: zOpenApi
        .object({
          entity_types: zOpenApi.array(zOpenApi.string()).optional(),
          entity_ids: zOpenApi.array(zOpenApi.string().uuid()).optional(),
          conditions: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
          tags: zOpenApi.array(zOpenApi.string()).optional(),
        })
        .optional(),
    }),
  );

  const WebhookSignatureBody = registry.registerSchema(
    'WebhookSignatureBodyV1',
    zOpenApi.object({
      algorithm: zOpenApi.enum(['sha1', 'sha256', 'sha512']),
      signature: zOpenApi.string(),
      timestamp: zOpenApi.number().optional(),
      body: zOpenApi.string(),
    }),
  );

  const WebhookEventBody = registry.registerSchema('WebhookEventBodyV1', zOpenApi.record(zOpenApi.unknown()));

  const ApiError = registry.registerSchema(
    'WebhookApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'WebhookApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.unknown(),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'WebhookApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.unknown()),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'x-api-key validated in ApiWebhookController.authenticate()',
    'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
    'x-rbac-resource': 'webhook',
  };

  function requestFor(path: string, handler: string) {
    const req: Record<string, unknown> = {};

    if (path.includes('{id}/deliveries/{delivery_id}')) {
      req.params = WebhookDeliveryParams;
    } else if (path.includes('{id}') || path.includes('/templates/{id}')) {
      req.params = WebhookIdParam;
    }

    if (['list', 'search'].includes(handler)) req.query = WebhookListQuery;
    if (['getAnalytics', 'getWebhookAnalytics'].includes(handler)) req.query = WebhookAnalyticsQuery;
    if (handler === 'getDeliveries') req.query = WebhookDeliveryQuery;
    if (handler === 'export') req.query = WebhookExportQuery;

    if (['create'].includes(handler)) req.body = { schema: CreateWebhookBody };
    if (['update'].includes(handler)) req.body = { schema: CreateWebhookBody.partial() };
    if (['test', 'testById'].includes(handler)) req.body = { schema: WebhookTestBody };
    if (handler === 'bulkOperation') req.body = { schema: BulkWebhookBody };
    if (handler === 'createSubscription') req.body = { schema: WebhookSubscriptionBody };
    if (handler === 'createTemplate') req.body = { schema: WebhookTemplateBody };
    if (handler === 'useTemplate') req.body = { schema: WebhookTemplateCreateBody };
    if (['testTransform', 'testTransformGeneric'].includes(handler)) req.body = { schema: WebhookTransformBody };
    if (['testFilter', 'testFilterGeneric'].includes(handler)) req.body = { schema: WebhookFilterTestBody };
    if (handler === 'verifySignature') req.body = { schema: WebhookSignatureBody };
    if (handler === 'triggerEvent') req.body = { schema: WebhookEventBody };
    if (handler === 'validateGeneric') req.body = { schema: CreateWebhookBody.partial() };

    return req;
  }

  function responsesFor(handler: string, path: string) {
    const responses: Record<number, any> = {
      400: { description: 'Invalid request payload/query/identifier.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user missing.', schema: ApiError },
      403: { description: 'Webhook RBAC permission denied.', schema: ApiError },
      500: { description: 'Unexpected webhook operation failure.', schema: ApiError },
    };

    if (handler === 'delete') {
      responses[204] = { description: 'Webhook deleted.', emptyBody: true };
      responses[404] = { description: 'Webhook not found.', schema: ApiError };
      return responses;
    }

    if (['getById', 'update', 'validate', 'getWebhookAnalytics', 'getDeliveries', 'getHealth'].includes(handler)) {
      responses[404] = { description: 'Webhook not found.', schema: ApiError };
    }

    if (handler === 'getDelivery') {
      responses[404] = { description: 'Delivery not found.', schema: ApiError };
    }

    if (['create', 'createTemplate', 'useTemplate', 'createSubscription'].includes(handler)) {
      responses[201] = { description: 'Resource created.', schema: ApiSuccess };
      return responses;
    }

    if (['list', 'search', 'getDeliveries'].includes(handler)) {
      responses[200] = { description: 'Paginated data returned.', schema: ApiPaginated };
    } else {
      responses[200] = { description: 'Operation succeeded.', schema: ApiSuccess };
    }

    if (path === '/api/v1/webhooks/subscriptions') {
      responses[400] = {
        description:
          'Current wiring calls ID-dependent methods (`getSubscriptions`/`createSubscription`) on a non-ID path, so extractIdFromPath validates the literal segment `subscriptions` as UUID and returns 400.',
        schema: ApiError,
      };
    }

    return responses;
  }

  const defs: Array<{
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    handler: string;
    action: string;
    summary: string;
    description: string;
    extraExtensions?: Record<string, unknown>;
  }> = [
    { method: 'get', path: '/api/v1/webhooks', handler: 'list', action: 'read', summary: 'List webhooks', description: 'Lists webhooks with pagination/filter query fields.' },
    { method: 'post', path: '/api/v1/webhooks', handler: 'create', action: 'create', summary: 'Create webhook', description: 'Creates a webhook configuration and delivery settings.' },
    { method: 'get', path: '/api/v1/webhooks/analytics', handler: 'getAnalytics', action: 'analytics', summary: 'Get system webhook analytics', description: 'Returns system-wide webhook analytics for date range.' },
    { method: 'post', path: '/api/v1/webhooks/bulk', handler: 'bulkOperation', action: 'bulk_update', summary: 'Run bulk webhook operation', description: 'Runs activate/deactivate/delete/test operations over webhook ID list.' },
    { method: 'get', path: '/api/v1/webhooks/events', handler: 'listEvents', action: 'read', summary: 'List available webhook events', description: 'Returns supported event type list (current controller returns stub values).' },
    { method: 'post', path: '/api/v1/webhooks/events/trigger', handler: 'triggerEvent', action: 'trigger', summary: 'Trigger webhook event manually', description: 'Triggers a webhook event payload (current controller returns stub result).' },
    { method: 'get', path: '/api/v1/webhooks/export', handler: 'export', action: 'export', summary: 'Export webhooks', description: 'Exports webhook definitions; query supports format and include_secrets.' },
    { method: 'post', path: '/api/v1/webhooks/filter/test', handler: 'testFilterGeneric', action: 'test', summary: 'Test generic webhook event filter', description: 'Tests filter logic against sample event without a specific webhook.' },
    { method: 'get', path: '/api/v1/webhooks/health', handler: 'getSystemHealth', action: 'read', summary: 'Get system webhook health', description: 'Returns system-level webhook health summary (currently stubbed).' },
    {
      method: 'get',
      path: '/api/v1/webhooks/search',
      handler: 'list',
      action: 'read',
      summary: 'Search webhooks (currently list wiring)',
      description: 'Route currently calls ApiWebhookController.list() instead of search(); behaves as list endpoint with standard list filters.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-expected': 'ApiWebhookController.search()' },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/subscriptions',
      handler: 'getSubscriptions',
      action: 'read',
      summary: 'List webhook subscriptions (global path wiring gap)',
      description: 'Calls getSubscriptions() on global path; method expects webhook id and currently fails UUID extraction for non-ID route.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-id-extraction-gap': true },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/subscriptions',
      handler: 'createSubscription',
      action: 'manage_subscriptions',
      summary: 'Create webhook subscription (global path wiring gap)',
      description: 'Calls createSubscription() on global path; method expects webhook id and currently fails UUID extraction for non-ID route.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-id-extraction-gap': true },
    },
    { method: 'get', path: '/api/v1/webhooks/templates', handler: 'listTemplates', action: 'read', summary: 'List webhook templates', description: 'Returns webhook templates for tenant/system scope.' },
    { method: 'post', path: '/api/v1/webhooks/templates', handler: 'createTemplate', action: 'system_settings', summary: 'Create webhook template', description: 'Creates a reusable webhook template.' },
    {
      method: 'get',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'getById',
      action: 'read',
      summary: 'Get webhook template detail (webhook getById wiring)',
      description: 'Template detail route currently delegates to webhook getById/update/delete handlers and therefore operates on webhooks, not template records.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.getById()' },
    },
    {
      method: 'put',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'update',
      action: 'update',
      summary: 'Update webhook template (webhook update wiring)',
      description: 'Template update route currently delegates to webhook update() handler.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.update()' },
    },
    {
      method: 'delete',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'delete',
      action: 'delete',
      summary: 'Delete webhook template (webhook delete wiring)',
      description: 'Template delete route currently delegates to webhook delete() handler.',
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.delete()' },
    },
    { method: 'post', path: '/api/v1/webhooks/templates/{id}/create', handler: 'useTemplate', action: 'create', summary: 'Create webhook from template', description: 'Creates webhook configuration from template + override payload.' },
    { method: 'post', path: '/api/v1/webhooks/test', handler: 'test', action: 'test', summary: 'Test webhook configuration', description: 'Runs test delivery against provided webhook test payload.' },
    { method: 'post', path: '/api/v1/webhooks/transform/test', handler: 'testTransformGeneric', action: 'test', summary: 'Test generic payload transformation', description: 'Evaluates transformation config against sample event (controller currently returns stub transformation output).' },
    { method: 'post', path: '/api/v1/webhooks/validate', handler: 'validateGeneric', action: 'read', summary: 'Validate webhook payload configuration', description: 'Validates webhook config payload using controller-side stub validation response.' },
    { method: 'post', path: '/api/v1/webhooks/verify', handler: 'verifySignature', action: 'verify', summary: 'Verify webhook signature', description: 'Validates signature payload (controller currently returns stub `{ valid: true }`).' },
    { method: 'delete', path: '/api/v1/webhooks/{id}', handler: 'delete', action: 'delete', summary: 'Delete webhook', description: 'Deletes one webhook by id.' },
    { method: 'get', path: '/api/v1/webhooks/{id}', handler: 'getById', action: 'read', summary: 'Get webhook', description: 'Gets one webhook by id.' },
    { method: 'put', path: '/api/v1/webhooks/{id}', handler: 'update', action: 'update', summary: 'Update webhook', description: 'Updates one webhook by id.' },
    { method: 'get', path: '/api/v1/webhooks/{id}/analytics', handler: 'getWebhookAnalytics', action: 'analytics', summary: 'Get webhook analytics', description: 'Returns analytics for one webhook id and date window.' },
    { method: 'get', path: '/api/v1/webhooks/{id}/deliveries', handler: 'getDeliveries', action: 'read', summary: 'List webhook deliveries', description: 'Returns paginated delivery history for one webhook id.' },
    { method: 'get', path: '/api/v1/webhooks/{id}/deliveries/{delivery_id}', handler: 'getDelivery', action: 'read', summary: 'Get delivery detail', description: 'Returns one delivery detail. Controller derives delivery_id from URL segment.' },
    { method: 'post', path: '/api/v1/webhooks/{id}/deliveries/{delivery_id}/retry', handler: 'retryDelivery', action: 'retry', summary: 'Retry delivery', description: 'Retries failed delivery by URL-derived delivery_id.' },
    { method: 'post', path: '/api/v1/webhooks/{id}/filter/test', handler: 'testFilter', action: 'test', summary: 'Test webhook filter', description: 'Evaluates filter rules against sample event for one webhook.' },
    { method: 'get', path: '/api/v1/webhooks/{id}/health', handler: 'getHealth', action: 'read', summary: 'Get webhook health', description: 'Returns health status for one webhook (controller currently returns stub health payload).' },
    { method: 'post', path: '/api/v1/webhooks/{id}/secret/rotate', handler: 'rotateSecret', action: 'manage_security', summary: 'Rotate webhook secret', description: 'Rotates webhook secret token (controller currently returns stub secret value).' },
    { method: 'get', path: '/api/v1/webhooks/{id}/subscriptions', handler: 'getSubscriptions', action: 'read', summary: 'List webhook subscriptions', description: 'Returns subscriptions for one webhook id (currently stubbed empty list).' },
    { method: 'post', path: '/api/v1/webhooks/{id}/subscriptions', handler: 'createSubscription', action: 'manage_subscriptions', summary: 'Create webhook subscription', description: 'Creates subscription under one webhook id (controller currently returns stub created subscription).' },
    { method: 'post', path: '/api/v1/webhooks/{id}/test', handler: 'testById', action: 'test', summary: 'Test webhook by id', description: 'Runs test delivery for one webhook id.' },
    { method: 'post', path: '/api/v1/webhooks/{id}/transform/test', handler: 'testTransform', action: 'test', summary: 'Test webhook transformation', description: 'Runs transformation test for one webhook id (controller returns stub transformation output).' },
    { method: 'post', path: '/api/v1/webhooks/{id}/validate', handler: 'validate', action: 'read', summary: 'Validate webhook by id', description: 'Validates persisted webhook config by id (controller currently returns stub validation result).' },
  ];

  for (const def of defs) {
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: requestFor(def.path, def.handler),
      responses: responsesFor(def.handler, def.path),
      extensions: {
        ...commonExtensions,
        'x-rbac-action': def.action,
        'x-controller-method': `ApiWebhookController.${def.handler}()`,
        ...(def.extraExtensions || {}),
      },
      edition: 'both',
    });
  }
}
