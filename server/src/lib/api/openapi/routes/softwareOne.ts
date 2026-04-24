import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerSoftwareOneRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'SoftwareOne Extensions';

  const SoftwareOneAgreement = registry.registerSchema(
    'SoftwareOneAgreement',
    zOpenApi.object({
      id: zOpenApi.string().describe('SoftwareOne agreement identifier, such as agr-001. This is an external SoftwareOne-style ID, not an Alga UUID.'),
      name: zOpenApi.string().describe('Human-readable agreement name.'),
      product: zOpenApi.string().describe('Product or SKU name associated with the agreement.'),
      vendor: zOpenApi.string().describe('Software vendor name, such as Microsoft or Adobe.'),
      consumer: zOpenApi.string().describe('End-customer organization name for the agreement.'),
      status: zOpenApi.enum(['active', 'inactive', 'pending', 'expired']).describe('Agreement status.'),
      currency: zOpenApi.string().describe('Three-letter billing currency code, such as USD.'),
      spxy: zOpenApi.number().describe('Annual SPx value from SoftwareOne dummy data.'),
      marginRpxy: zOpenApi.number().describe('Margin RPxY value from SoftwareOne dummy data.'),
      operations: zOpenApi.enum(['visible', 'hidden', 'restricted']).describe('Operational visibility state for the agreement.'),
      billingConfigId: zOpenApi.string().describe('SoftwareOne billing configuration identifier associated with the agreement.'),
      localConfig: zOpenApi
        .object({
          autoRenewal: zOpenApi.boolean().optional().describe('Whether local auto-renewal is enabled.'),
          notificationDays: zOpenApi.number().int().optional().describe('Days before renewal/expiry to notify.'),
          markup: zOpenApi.number().optional().describe('Optional local markup percentage used by richer SoftwareOne schemas.'),
          notes: zOpenApi.string().optional().describe('Optional local notes.'),
          tags: zOpenApi.array(zOpenApi.string()).optional().describe('Optional local tags.'),
        })
        .passthrough()
        .optional()
        .describe('Locally editable configuration metadata. Current MVP data includes autoRenewal and notificationDays.'),
    }),
  );

  const SoftwareOnePaginationMeta = registry.registerSchema(
    'SoftwareOnePaginationMeta',
    zOpenApi.object({
      total: zOpenApi.number().int().describe('Total agreements returned by the current dummy implementation.'),
      page: zOpenApi.number().int().describe('Current page number. Currently hardcoded to 1.'),
      pageSize: zOpenApi.number().int().describe('Page size. Currently hardcoded to 50.'),
    }),
  );

  const SoftwareOneAgreementsListResponse = registry.registerSchema(
    'SoftwareOneAgreementsListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneAgreement).describe('SoftwareOne agreement records.'),
      meta: SoftwareOnePaginationMeta,
    }),
  );

  const SoftwareOneErrorResponse = registry.registerSchema(
    'SoftwareOneErrorResponse',
    zOpenApi.object({
      success: zOpenApi.literal(false).describe('Request failed.'),
      error: zOpenApi.string().describe('Human-readable error message.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/agreements',
    summary: 'List SoftwareOne agreements',
    description:
      'Returns SoftwareOne agreement records available to the SoftwareOne extension. The current handler is an MVP placeholder backed by hardcoded dummy data; comments in the route indicate that a full implementation will validate permissions, derive tenant context, fetch from the SoftwareOne API, and apply filtering, sorting, and pagination. This route is not in the middleware API-key skip list, so callers must provide x-api-key at the API layer.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: 'Agreement list returned successfully.',
        schema: SoftwareOneAgreementsListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: zOpenApi.object({ error: zOpenApi.string().describe('Middleware authentication error message.') }),
      },
      500: {
        description: 'Unexpected failure while fetching agreements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });
}
