import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerSystemRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'System';

  const HealthResponse = registry.registerSchema(
    'HealthResponse',
    zOpenApi.object({
      status: zOpenApi.literal('ok').describe('Always ok when the API process is reachable.'),
      version: zOpenApi.string().describe('Hardcoded API version string returned by the handler.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/health',
    summary: 'Health check',
    description:
      'Simple unauthenticated liveness check for the Next.js API process. It performs no database, Redis, or downstream dependency checks and returns a fixed status/version payload when the process can serve HTTP requests.',
    tags: [tag],
    security: [],
    responses: {
      200: {
        description: 'API process is alive and responding.',
        schema: HealthResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-dependency-checks': false,
    },
    edition: 'both',
  });
}
