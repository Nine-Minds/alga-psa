import { ApiOpenApiRegistry, zOpenApi } from './registry';

export function registerBaseComponents(registry: ApiOpenApiRegistry) {
  registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
  });

  const ErrorResponse = registry.registerSchema(
    'ErrorResponse',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const PlaceholderObject = registry.registerSchema(
    'PlaceholderObject',
    zOpenApi.object({}).passthrough(),
  );

  return {
    ErrorResponse,
    PlaceholderObject,
  };
}
