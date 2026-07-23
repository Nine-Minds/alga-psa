import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerMobileCapabilitiesV1Routes(registry: ApiOpenApiRegistry) {
  const CapabilitiesSuccess = registry.registerSchema(
    'MobileCapabilitiesSuccessV1',
    zOpenApi.object({
      data: zOpenApi.object({
        features: zOpenApi.object({
          inventory: zOpenApi.boolean(),
          opportunities: zOpenApi.boolean(),
        }),
      }),
    }),
  );
  const ApiError = registry.registerSchema(
    'MobileCapabilitiesApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/mobile/me/capabilities',
    summary: 'Get current mobile feature capabilities',
    description: 'Returns tenant-product and RBAC-derived mobile feature availability for the authenticated API-key user.',
    tags: ['Mobile v1'],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Current mobile feature capabilities.', schema: CapabilitiesSuccess },
      401: { description: 'API key missing or invalid.', schema: ApiError },
      500: { description: 'Unexpected controller or service failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
      'x-rbac-resource': 'inventory/read and opportunities/read',
    },
    edition: 'both',
  });
}
