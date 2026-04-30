import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAdminRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Admin';

  const TelemetrySettingsGetResponse = registry.registerSchema(
    'TelemetrySettingsGetResponse',
    zOpenApi.object({
      usageStatsEnabled: zOpenApi.boolean().describe('Whether usage statistics are enabled by the ALGA_USAGE_STATS environment variable.'),
      environmentVariable: zOpenApi.literal('ALGA_USAGE_STATS').describe('Environment variable controlling telemetry collection.'),
      currentValue: zOpenApi.string().describe('Raw ALGA_USAGE_STATS environment value, or not set when absent.'),
      controlledBy: zOpenApi.literal('environment').describe('Telemetry is controlled by process environment, not runtime API writes.'),
      message: zOpenApi.string().describe('Human-readable explanation of the current telemetry setting.'),
    }),
  );

  const TelemetrySettingsPostResponse = registry.registerSchema(
    'TelemetrySettingsPostResponse',
    zOpenApi.object({
      usageStatsEnabled: zOpenApi.boolean().describe('Whether usage statistics are enabled by the ALGA_USAGE_STATS environment variable.'),
      controlledBy: zOpenApi.literal('environment').describe('Telemetry is controlled by process environment, not runtime API writes.'),
      message: zOpenApi.string().describe('Explains that telemetry settings cannot be changed through this API.'),
    }),
  );

  const AdminTelemetryErrorResponse = registry.registerSchema(
    'AdminTelemetryErrorResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Error message such as Authentication required, Insufficient permissions, or the handler failure message.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/admin/telemetry-settings',
    summary: 'Get telemetry settings',
    description:
      'Returns tenant admin telemetry status derived from the ALGA_USAGE_STATS environment variable. The handler resolves the tenant with createTenantKnex, requires an authenticated current user, and checks the tenant-scoped users.role value for admin or owner. The route does not read or write tenant telemetry settings from the database. Because this session-authenticated route is not currently in apiKeySkipPaths, API middleware also requires an x-api-key header to be present before the handler can run.',
    tags: [tag, 'Telemetry'],
    security: [{ ApiKeyAuth: [], SessionCookieAuth: [] }],
    responses: {
      200: {
        description: 'Current telemetry setting returned successfully.',
        schema: TelemetrySettingsGetResponse,
      },
      401: {
        description: 'No authenticated current user, no tenant context, or x-api-key missing at middleware.',
        schema: AdminTelemetryErrorResponse,
      },
      403: {
        description: 'Authenticated user is not an admin or owner in the tenant.',
        schema: AdminTelemetryErrorResponse,
      },
      500: {
        description: 'Unexpected failure while loading telemetry settings.',
        schema: AdminTelemetryErrorResponse,
      },
    },
    extensions: {
      'x-rbac-roles': ['admin', 'owner'],
      'x-tenant-scoped': true,
      'x-controlled-by': 'ALGA_USAGE_STATS',
      'x-middleware-api-key-required-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/admin/telemetry-settings',
    summary: 'Check telemetry settings update status',
    description:
      'No-op endpoint for telemetry settings. The handler authenticates the current user, verifies the tenant-scoped users.role is admin or owner, ignores the request body, performs no database write, and returns the current ALGA_USAGE_STATS-derived status with a message explaining that telemetry cannot be changed through the API. Because this session-authenticated route is not currently in apiKeySkipPaths, API middleware also requires an x-api-key header to be present before the handler can run.',
    tags: [tag, 'Telemetry'],
    security: [{ ApiKeyAuth: [], SessionCookieAuth: [] }],
    responses: {
      200: {
        description: 'Telemetry status returned; no setting was changed.',
        schema: TelemetrySettingsPostResponse,
      },
      401: {
        description: 'No authenticated current user, no tenant context, or x-api-key missing at middleware.',
        schema: AdminTelemetryErrorResponse,
      },
      403: {
        description: 'Authenticated user is not an admin or owner in the tenant.',
        schema: AdminTelemetryErrorResponse,
      },
      500: {
        description: 'Unexpected failure while processing the no-op update request.',
        schema: AdminTelemetryErrorResponse,
      },
    },
    extensions: {
      'x-rbac-roles': ['admin', 'owner'],
      'x-tenant-scoped': true,
      'x-controlled-by': 'ALGA_USAGE_STATS',
      'x-request-body-ignored': true,
      'x-runtime-mutation': false,
      'x-middleware-api-key-required-currently': true,
    },
    edition: 'both',
  });
}
