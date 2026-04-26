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

  const HealthzResponse = registry.registerSchema(
    'HealthzResponse',
    zOpenApi.object({
      status: zOpenApi.literal('healthy').describe('Always healthy when the process can serve HTTP.'),
      timestamp: zOpenApi.string().datetime().describe('ISO timestamp generated when the liveness check is handled.'),
      uptime: zOpenApi.number().nonnegative().describe('Process uptime in seconds from process.uptime().'),
      version: zOpenApi.string().describe('Application version from the environment/package metadata, with a fallback in the handler.'),
      environment: zOpenApi.string().optional().describe('NODE_ENV value returned by the Next.js /api/healthz handler.'),
    }),
  );

  const ReadyzChecks = registry.registerSchema(
    'ReadyzChecks',
    zOpenApi.object({
      database: zOpenApi.boolean().describe('True when a SELECT 1 database connectivity check succeeds.'),
      redis: zOpenApi.boolean().describe('Redis readiness placeholder. Currently mirrors the database check result.'),
    }),
  );

  const ReadyzReadyResponse = registry.registerSchema(
    'ReadyzReadyResponse',
    zOpenApi.object({
      status: zOpenApi.literal('ready').describe('All critical dependencies checked by this handler are available.'),
      timestamp: zOpenApi.string().datetime().describe('ISO timestamp generated when the readiness check is handled.'),
      uptime: zOpenApi.number().nonnegative().describe('Process uptime in seconds from process.uptime().'),
      version: zOpenApi.string().describe('Application version from npm_package_version, with handler fallback.'),
      checks: ReadyzChecks,
    }),
  );

  const ReadyzNotReadyResponse = registry.registerSchema(
    'ReadyzNotReadyResponse',
    zOpenApi.object({
      status: zOpenApi.literal('not_ready').describe('One or more critical dependencies are unavailable.'),
      timestamp: zOpenApi.string().datetime().describe('ISO timestamp generated when the readiness check is handled.'),
      uptime: zOpenApi.number().nonnegative().optional().describe('Process uptime in seconds. Present in the dependency-failure branch, omitted by the catch branch.'),
      version: zOpenApi.string().optional().describe('Application version. Present only in the ready response branch.'),
      checks: ReadyzChecks,
      error: zOpenApi.string().describe('Readiness failure reason or caught exception message.'),
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

  registry.registerRoute({
    method: 'get',
    path: '/api/healthz',
    summary: 'Liveness probe',
    description:
      'Kubernetes liveness endpoint. It returns a fixed healthy status with timestamp, uptime, version, and environment when the process can serve HTTP. It does not check database, Redis, or downstream dependencies; use /api/readyz for dependency-aware readiness.',
    tags: [tag],
    security: [],
    responses: {
      200: {
        description: 'Process is alive and serving HTTP.',
        schema: HealthzResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-dependency-checks': false,
      'x-kubernetes-probe': 'liveness',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/readyz',
    summary: 'Readiness probe',
    description:
      'Kubernetes readiness endpoint for the Next.js API route. It checks database connectivity with SELECT 1 and returns 200 only when critical dependencies are available. The Redis check is currently a placeholder that mirrors the database result. This endpoint is unauthenticated and is explicitly skipped by API-key middleware.',
    tags: [tag],
    security: [],
    responses: {
      200: {
        description: 'All critical dependencies checked by this handler are available.',
        schema: ReadyzReadyResponse,
      },
      503: {
        description: 'One or more critical dependencies are unavailable, or a readiness check threw an exception.',
        schema: ReadyzNotReadyResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-dependency-checks': true,
      'x-kubernetes-probe': 'readiness',
      'x-redis-check-stubbed': true,
    },
    edition: 'both',
  });
}
