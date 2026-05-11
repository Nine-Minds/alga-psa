import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ApiResponseSpec } from '../types';

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

  const DeliveryListQuery = zOpenApi.object({
    page: zOpenApi.string().optional(),
    limit: zOpenApi.string().optional(),
    status: zOpenApi.enum(['pending', 'dispatched', 'duplicate', 'failed']).optional(),
    date_from: zOpenApi.string().datetime().optional(),
    date_to: zOpenApi.string().datetime().optional(),
  });

  const InboundWebhookConfig = zOpenApi.record(zOpenApi.unknown()).describe('Inbound webhook configuration.');
  const InboundWebhookDelivery = zOpenApi.record(zOpenApi.unknown()).describe('Inbound webhook delivery.');
  const InboundActionDefinition = zOpenApi.record(zOpenApi.unknown()).describe('Inbound action definition.');
  const InboundWebhookInput = zOpenApi.record(zOpenApi.unknown()).describe('Inbound webhook create/update input.');
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
    body?: typeof InboundWebhookInput | typeof SyntheticTestInput;
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
      body: InboundWebhookInput,
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
      body: InboundWebhookInput,
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
}
