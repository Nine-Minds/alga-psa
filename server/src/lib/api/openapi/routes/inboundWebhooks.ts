import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ApiResponseSpec } from '../types';
import type { ZodTypeAny } from 'zod';

export function registerInboundWebhookRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Inbound Webhooks';

  const ApiError = zOpenApi.object({
    error: zOpenApi.object({
      code: zOpenApi.string(),
      message: zOpenApi.string(),
      details: zOpenApi.unknown().optional(),
    }),
  });

  const InboundWebhookIdParam = zOpenApi.object({
    id: zOpenApi.string().uuid().describe('Inbound webhook UUID.'),
  });

  const InboundDeliveryParams = zOpenApi.object({
    id: zOpenApi.string().uuid().describe('Inbound webhook UUID.'),
    deliveryId: zOpenApi.string().uuid().describe('Inbound delivery UUID.'),
  });

  const ReceiverParams = zOpenApi.object({
    tenantSlug: zOpenApi.string().describe('URL-safe tenant slug used for inbound webhook routing.'),
    webhookSlug: zOpenApi.string().describe('URL-safe inbound webhook slug unique within the tenant.'),
  });

  const ReceiverHeaders = zOpenApi.object({
    'content-type': zOpenApi.string().optional().describe('Expected to be application/json for JSON payloads.'),
    'x-signature': zOpenApi
      .string()
      .optional()
      .describe('Example HMAC-SHA256 signature header. Actual header name is webhook-configurable.'),
    'x-idempotency-key': zOpenApi
      .string()
      .optional()
      .describe('Optional idempotency key header when the webhook uses a header idempotency source.'),
  });

  const DeliveryListQuery = zOpenApi.object({
    page: zOpenApi.string().optional(),
    limit: zOpenApi.string().optional(),
    status: zOpenApi.enum(['pending', 'dispatched', 'duplicate', 'failed']).optional(),
    date_from: zOpenApi.string().datetime().optional(),
    date_to: zOpenApi.string().datetime().optional(),
  });

  const InboundWebhookConfig = registry.registerSchema(
    'InboundWebhookConfig',
    zOpenApi.object({
      inboundWebhookId: zOpenApi.string().uuid(),
      tenant: zOpenApi.string().uuid(),
      name: zOpenApi.string(),
      slug: zOpenApi.string(),
      description: zOpenApi.string().nullable(),
      authType: zOpenApi.enum(['hmac_sha256', 'bearer', 'ip_allowlist', 'path_token']),
      authConfig: zOpenApi.record(zOpenApi.unknown()).describe('Redacted auth configuration metadata.'),
      idempotencySource: zOpenApi
        .object({
          type: zOpenApi.enum(['header', 'jsonata']),
          value: zOpenApi.string(),
        })
        .nullable(),
      idempotencyWindowSeconds: zOpenApi.number().int(),
      handlerType: zOpenApi.enum(['direct_action', 'workflow']),
      handlerConfig: zOpenApi.record(zOpenApi.unknown()),
      samplePayload: zOpenApi.unknown().nullable(),
      sampleCaptureExpiresAt: zOpenApi.string().datetime().nullable(),
      isActive: zOpenApi.boolean(),
      rateLimitPerMinute: zOpenApi.number().int(),
      autoDisabledAt: zOpenApi.string().datetime().nullable(),
      createdBy: zOpenApi.string().uuid().nullable(),
      createdAt: zOpenApi.string().datetime(),
      updatedAt: zOpenApi.string().datetime(),
    }),
  );
  const InboundWebhookDelivery = registry.registerSchema(
    'InboundWebhookDelivery',
    zOpenApi.object({
      tenant: zOpenApi.string().uuid(),
      deliveryId: zOpenApi.string().uuid(),
      inboundWebhookId: zOpenApi.string().uuid().nullable(),
      idempotencyKey: zOpenApi.string().nullable(),
      receivedAt: zOpenApi.string().datetime(),
      requestMethod: zOpenApi.string(),
      requestPath: zOpenApi.string(),
      requestHeaders: zOpenApi.record(zOpenApi.union([zOpenApi.string(), zOpenApi.array(zOpenApi.string())])),
      requestBody: zOpenApi.unknown().nullable(),
      sourceIp: zOpenApi.string().nullable(),
      userAgent: zOpenApi.string().nullable(),
      authStatus: zOpenApi.enum([
        'verified',
        'rejected_signature',
        'rejected_bearer',
        'rejected_ip',
        'rejected_no_auth',
      ]),
      dispatchStatus: zOpenApi.enum(['pending', 'dispatched', 'duplicate', 'failed']),
      handlerOutcome: zOpenApi.record(zOpenApi.unknown()).nullable(),
      responseStatus: zOpenApi.number().int().nullable(),
      responseBody: zOpenApi.unknown().nullable(),
      durationMs: zOpenApi.number().int().nullable(),
      retryCount: zOpenApi.number().int(),
      isReplay: zOpenApi.boolean(),
      replayedFrom: zOpenApi.string().uuid().nullable(),
      createdAt: zOpenApi.string().datetime(),
      updatedAt: zOpenApi.string().datetime(),
    }),
  );
  const InboundActionTargetField = registry.registerSchema(
    'InboundActionTargetField',
    zOpenApi.object({
      name: zOpenApi.string(),
      type: zOpenApi.enum(['string', 'int', 'number', 'boolean', 'enum', 'object', 'array', 'ref']),
      required: zOpenApi.boolean(),
      description: zOpenApi.string(),
      enumValues: zOpenApi.array(zOpenApi.string()).optional(),
      refEntityType: zOpenApi.string().optional(),
    }),
  );
  const InboundActionDefinition = registry.registerSchema(
    'InboundActionDefinition',
    zOpenApi.object({
      name: zOpenApi.string(),
      entityType: zOpenApi.string(),
      displayName: zOpenApi.string(),
      description: zOpenApi.string(),
      targetFields: zOpenApi.array(InboundActionTargetField),
    }),
  );
  const InboundWebhookCreateInput = registry.registerSchema(
    'InboundWebhookCreateInput',
    zOpenApi.object({
      name: zOpenApi.string().min(1),
      slug: zOpenApi.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
      description: zOpenApi.string().nullable().optional(),
      auth_type: zOpenApi.enum(['hmac_sha256', 'bearer', 'ip_allowlist', 'path_token']),
      auth_config: zOpenApi.record(zOpenApi.unknown()),
      idempotency_source: zOpenApi
        .object({
          type: zOpenApi.enum(['header', 'jsonata']),
          value: zOpenApi.string(),
        })
        .nullable()
        .optional(),
      idempotency_window_seconds: zOpenApi.number().int().positive().optional(),
      handler_type: zOpenApi.enum(['direct_action', 'workflow']),
      handler_config: zOpenApi.record(zOpenApi.unknown()),
      is_active: zOpenApi.boolean().optional(),
      rate_limit_per_minute: zOpenApi.number().int().positive().optional(),
    }),
  );
  registry.registerSchema(
    'InboundWebhookAuthConfig',
    zOpenApi.discriminatedUnion('auth_type', [
      zOpenApi.object({
        auth_type: zOpenApi.literal('hmac_sha256'),
        auth_config: zOpenApi.object({
          signature_header: zOpenApi.string().describe('Header containing sha256=<hex> or raw hex HMAC.'),
          secret: zOpenApi.string().optional().describe('Create/update-time secret; never returned after storage.'),
          secret_vault_path: zOpenApi.string().optional().describe('Stored vault path metadata returned by reads.'),
        }),
      }),
      zOpenApi.object({
        auth_type: zOpenApi.literal('bearer'),
        auth_config: zOpenApi.object({
          token: zOpenApi.string().optional().describe('Create/update-time bearer token; never returned after storage.'),
          token_vault_path: zOpenApi.string().optional().describe('Stored vault path metadata returned by reads.'),
        }),
      }),
      zOpenApi.object({
        auth_type: zOpenApi.literal('ip_allowlist'),
        auth_config: zOpenApi.object({
          ip_cidrs: zOpenApi.array(zOpenApi.string()).describe('Exact IP strings or CIDR ranges accepted.'),
        }),
      }),
      zOpenApi.object({
        auth_type: zOpenApi.literal('path_token'),
        auth_config: zOpenApi.object({
          query_param: zOpenApi.string().optional().describe('Query parameter name, default token.'),
          token: zOpenApi.string().optional().describe('Create/update-time path token; never returned after storage.'),
          token_vault_path: zOpenApi.string().optional().describe('Stored vault path metadata returned by reads.'),
        }),
      }),
    ]),
  );
  registry.registerSchema(
    'InboundWebhookHandlerConfig',
    zOpenApi.discriminatedUnion('handler_type', [
      zOpenApi.object({
        handler_type: zOpenApi.literal('direct_action'),
        handler_config: zOpenApi.object({
          action: zOpenApi.string().describe('Registered inbound action name.'),
          field_mapping: zOpenApi
            .record(zOpenApi.string())
            .describe('Map of target field name to JSONata expression evaluated against the request body.'),
        }),
      }),
      zOpenApi.object({
        handler_type: zOpenApi.literal('workflow'),
        handler_config: zOpenApi.object({
          workflow_id: zOpenApi.string().uuid().describe('Workflow definition to start for verified deliveries.'),
        }),
      }),
    ]),
  );
  const InboundWebhookUpdateInput = registry.registerSchema(
    'InboundWebhookUpdateInput',
    InboundWebhookCreateInput.extend({
      inbound_webhook_id: zOpenApi.string().uuid().optional(),
    }).partial(),
  );
  const SyntheticTestInput = zOpenApi.object({
    body: zOpenApi.unknown().optional(),
    headers: zOpenApi.record(zOpenApi.union([zOpenApi.string(), zOpenApi.array(zOpenApi.string())])).optional(),
  });

  const ConfigEnvelope = zOpenApi.object({
    data: InboundWebhookConfig,
    secret: zOpenApi.string().nullable().optional(),
  });
  const ConfigListEnvelope = zOpenApi.object({
    data: zOpenApi.array(InboundWebhookConfig),
  });
  const DeliveryEnvelope = zOpenApi.object({
    data: InboundWebhookDelivery,
  });
  const DeliveryListEnvelope = zOpenApi.object({
    data: zOpenApi.array(InboundWebhookDelivery),
    meta: zOpenApi.object({
      page: zOpenApi.number().int(),
      limit: zOpenApi.number().int(),
      total: zOpenApi.number().int(),
    }),
  });
  const ActionListEnvelope = zOpenApi.object({
    data: zOpenApi.array(InboundActionDefinition),
  });
  const ReceiverAcceptedEnvelope = zOpenApi.object({
    delivery_id: zOpenApi.string().uuid(),
  });
  registry.registerSchema(
    'WorkflowWebhookEnvelope',
    zOpenApi.object({
      source: zOpenApi.string().describe('Inbound webhook slug.'),
      body: zOpenApi.unknown().describe('Parsed JSON request body as received.'),
      headers: zOpenApi
        .record(zOpenApi.union([zOpenApi.string(), zOpenApi.array(zOpenApi.string())]))
        .describe('Filtered safe request headers.'),
      verified: zOpenApi.literal(true),
      delivery_id: zOpenApi.string().uuid(),
      idempotency_key: zOpenApi.string().nullable(),
      received_at: zOpenApi.string().datetime(),
    }),
  );

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'withAuth server action session context',
    'x-rbac-resource': 'inbound_webhook',
  };

  function responses(success: ApiResponseSpec, extra: Record<number, ApiResponseSpec> = {}) {
    return {
      400: { description: 'Invalid inbound webhook request.', schema: ApiError },
      401: { description: 'Missing or invalid authenticated user context.', schema: ApiError },
      403: { description: 'Inbound webhook permission denied.', schema: ApiError },
      500: { description: 'Unexpected inbound webhook operation failure.', schema: ApiError },
      ...extra,
      [success.emptyBody ? 204 : (success.description.includes('created') ? 201 : 200)]: success,
    };
  }

  type RouteDef = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    action: string;
    summary: string;
    description: string;
    success: ApiResponseSpec;
    params?: typeof InboundWebhookIdParam | typeof InboundDeliveryParams;
    query?: typeof DeliveryListQuery;
    body?: ZodTypeAny;
    extraResponses?: Record<number, ApiResponseSpec>;
  };

  const defs: RouteDef[] = [
    {
      method: 'get',
      path: '/api/v1/inbound-webhooks',
      action: 'read',
      summary: 'List inbound webhooks',
      description: 'Lists tenant inbound webhook configurations.',
      success: { description: 'Inbound webhook list returned.', schema: ConfigListEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/inbound-webhooks',
      action: 'create',
      summary: 'Create inbound webhook',
      description: 'Creates an inbound webhook configuration and returns any one-time generated secret.',
      body: InboundWebhookCreateInput,
      success: { description: 'Inbound webhook created.', schema: ConfigEnvelope },
      extraResponses: { 409: { description: 'Inbound webhook slug already exists.', schema: ApiError } },
    },
    {
      method: 'get',
      path: '/api/v1/inbound-webhooks/actions',
      action: 'read',
      summary: 'List inbound webhook actions',
      description: 'Returns registered direct-action definitions with target field schemas.',
      success: { description: 'Inbound action definitions returned.', schema: ActionListEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/inbound-webhooks/{id}',
      action: 'read',
      summary: 'Get inbound webhook',
      description: 'Returns a single inbound webhook configuration.',
      params: InboundWebhookIdParam,
      success: { description: 'Inbound webhook returned.', schema: ConfigEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'put',
      path: '/api/v1/inbound-webhooks/{id}',
      action: 'update',
      summary: 'Update inbound webhook',
      description: 'Updates an inbound webhook configuration by id.',
      params: InboundWebhookIdParam,
      body: InboundWebhookUpdateInput,
      success: { description: 'Inbound webhook updated.', schema: ConfigEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'delete',
      path: '/api/v1/inbound-webhooks/{id}',
      action: 'delete',
      summary: 'Delete inbound webhook',
      description: 'Deletes an inbound webhook configuration by id.',
      params: InboundWebhookIdParam,
      success: { description: 'Inbound webhook deleted.', emptyBody: true },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'post',
      path: '/api/v1/inbound-webhooks/{id}/rotate-secret',
      action: 'update',
      summary: 'Rotate inbound webhook secret',
      description: 'Rotates the inbound webhook authentication secret and returns the replacement once.',
      params: InboundWebhookIdParam,
      success: { description: 'Inbound webhook secret rotated.', schema: ConfigEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'post',
      path: '/api/v1/inbound-webhooks/{id}/test',
      action: 'update',
      summary: 'Send inbound webhook test request',
      description: 'Dispatches a synthetic inbound request through the current webhook configuration.',
      params: InboundWebhookIdParam,
      body: SyntheticTestInput,
      success: { description: 'Synthetic inbound delivery accepted.', schema: DeliveryEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'post',
      path: '/api/v1/inbound-webhooks/{id}/capture-sample',
      action: 'update',
      summary: 'Enable inbound webhook sample capture',
      description: 'Enables capture mode so the next verified request stores its body as the sample payload.',
      params: InboundWebhookIdParam,
      success: { description: 'Sample capture enabled.', schema: ConfigEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'delete',
      path: '/api/v1/inbound-webhooks/{id}/capture-sample',
      action: 'update',
      summary: 'Clear inbound webhook sample payload',
      description: 'Clears the saved sample payload and disables sample capture.',
      params: InboundWebhookIdParam,
      success: { description: 'Sample payload cleared.', schema: ConfigEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'get',
      path: '/api/v1/inbound-webhooks/{id}/deliveries',
      action: 'read',
      summary: 'List inbound webhook deliveries',
      description: 'Returns paginated delivery history for one inbound webhook.',
      params: InboundWebhookIdParam,
      query: DeliveryListQuery,
      success: { description: 'Inbound delivery list returned.', schema: DeliveryListEnvelope },
      extraResponses: { 404: { description: 'Inbound webhook not found.', schema: ApiError } },
    },
    {
      method: 'get',
      path: '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}',
      action: 'read',
      summary: 'Get inbound webhook delivery',
      description: 'Returns a single inbound webhook delivery row including request and response details.',
      params: InboundDeliveryParams,
      success: { description: 'Inbound delivery returned.', schema: DeliveryEnvelope },
      extraResponses: { 404: { description: 'Inbound delivery not found.', schema: ApiError } },
    },
    {
      method: 'post',
      path: '/api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}/replay',
      action: 'replay',
      summary: 'Replay inbound webhook delivery',
      description: 'Re-dispatches a stored inbound delivery against the current webhook configuration.',
      params: InboundDeliveryParams,
      success: { description: 'Inbound delivery replay accepted.', schema: DeliveryEnvelope },
      extraResponses: { 404: { description: 'Inbound delivery not found.', schema: ApiError } },
    },
  ];

  for (const def of defs) {
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: { schema: def.body } } : {}),
      },
      responses: responses(def.success, def.extraResponses),
      extensions: {
        ...commonExtensions,
        'x-rbac-action': def.action,
        'x-handler': `server/src/app${def.path}/route.ts`,
      },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'post',
    path: '/api/inbound/{tenantSlug}/{webhookSlug}',
    summary: 'Receive inbound webhook payload',
    description:
      'Receives a JSON payload for a tenant inbound webhook. Authentication, idempotency, rate limit, and handler behavior are controlled by the webhook configuration.',
    tags: [tag],
    request: {
      params: ReceiverParams,
      headers: ReceiverHeaders,
      body: {
        schema: zOpenApi.unknown(),
        description: 'Source-specific JSON payload. Shape varies per inbound webhook configuration.',
      },
    },
    responses: {
      200: { description: 'Request accepted or treated as duplicate no-op.', schema: ReceiverAcceptedEnvelope },
      400: { description: 'Invalid request payload or handler validation failure.', schema: ApiError },
      401: {
        description:
          'Authentication failed or receiver is unknown/inactive. Response body is intentionally empty to avoid leaking which webhooks exist.',
      },
      429: { description: 'Per-webhook rate limit exceeded.', schema: ApiError },
      500: { description: 'Unexpected dispatch failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'per-webhook auth configuration',
      'x-rbac-resource': 'inbound_webhook',
      'x-handler': 'server/src/app/api/inbound/[tenantSlug]/[webhookSlug]/route.ts',
    },
    edition: 'both',
  });
}
