import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerMetaUtilityV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Meta & Utility v1';

  const FeatureFlagsPostBody = registry.registerSchema(
    'FeatureFlagsPostBodyV1',
    zOpenApi.object({
      flags: zOpenApi.array(zOpenApi.string()).optional(),
      context: zOpenApi
        .object({
          userRole: zOpenApi.string().optional(),
          companySize: zOpenApi.enum(['small', 'medium', 'large', 'enterprise']).optional(),
          subscriptionPlan: zOpenApi.string().optional(),
          customProperties: zOpenApi.record(zOpenApi.unknown()).optional(),
        })
        .optional(),
    }),
  );

  const FeatureAccessBody = registry.registerSchema(
    'FeatureAccessBodyV1',
    zOpenApi.object({
      user_id: zOpenApi.string().uuid().optional(),
      feature_name: zOpenApi.string(),
    }),
  );

  const ApiError = registry.registerSchema(
    'MetaUtilityApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.unknown(),
      message: zOpenApi.string().optional(),
      details: zOpenApi.unknown().optional(),
      success: zOpenApi.boolean().optional(),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'MetaUtilityApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.unknown().optional(),
      flags: zOpenApi.record(zOpenApi.unknown()).optional(),
      context: zOpenApi.record(zOpenApi.unknown()).optional(),
      enabled: zOpenApi.boolean().optional(),
      reason: zOpenApi.string().optional(),
      usageStatsEnabled: zOpenApi.boolean().optional(),
      controlledBy: zOpenApi.string().optional(),
      message: zOpenApi.string().optional(),
      success: zOpenApi.boolean().optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'delete';
    path: string;
    summary: string;
    description: string;
    security: 'api-key' | 'session' | 'mixed';
  };

  const defs: Def[] = [
    { method: 'post', path: '/api/v1/feature-access', summary: 'Check feature access', description: 'Checks feature access via ApiPermissionController.checkFeatureAccess() using API key auth and permission read checks.', security: 'api-key' },
    { method: 'get', path: '/api/v1/feature-flags', summary: 'Get feature flags', description: 'Returns feature flags for current session user; route uses getSession() and featureFlags service.', security: 'mixed' },
    { method: 'post', path: '/api/v1/feature-flags', summary: 'Evaluate feature flags with custom context', description: 'Evaluates requested/all flags with optional custom context payload; requires session user.', security: 'mixed' },

    { method: 'get', path: '/api/v1/meta/docs', summary: 'Get API docs', description: 'Returns Swagger UI HTML or redirects to OpenAPI endpoint depending on format query.', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/endpoints', summary: 'List API endpoints metadata', description: 'Returns endpoint inventory metadata via ApiMetadataController.getEndpoints().', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/health', summary: 'Get API health metadata', description: 'Returns API health metadata via ApiMetadataController.getHealth().', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/openapi', summary: 'Get generated OpenAPI metadata', description: 'Returns generated OpenAPI document JSON/YAML based on query format.', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/permissions', summary: 'List API permissions metadata', description: 'Returns permission metadata via ApiMetadataController.getPermissions().', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/schemas', summary: 'List API schemas metadata', description: 'Returns schema metadata via ApiMetadataController.getSchemas().', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/sdk', summary: 'Generate SDK metadata payload', description: 'Generates SDK structure payload for selected language/format via generateSdk().', security: 'api-key' },
    { method: 'get', path: '/api/v1/meta/stats', summary: 'Get API stats metadata', description: 'Returns API usage stats for requested period via getStats().', security: 'api-key' },

    { method: 'get', path: '/api/v1/test-auth', summary: 'Test API key auth', description: 'Debug endpoint wrapping withApiKeyAuth middleware; returns authenticated request context payload.', security: 'api-key' },

    { method: 'get', path: '/api/v1/user/telemetry-decision', summary: 'Get telemetry decision', description: 'Returns telemetry enabled/disabled decision from environment for current session user.', security: 'mixed' },
    { method: 'get', path: '/api/v1/user/telemetry-preferences', summary: 'Get telemetry preferences', description: 'Returns telemetry preference view controlled by environment variable; requires session user.', security: 'mixed' },
    { method: 'post', path: '/api/v1/user/telemetry-preferences', summary: 'Set telemetry preferences (environment-controlled)', description: 'Endpoint acknowledges request but reports environment-controlled behavior rather than persisting user preference.', security: 'mixed' },
    { method: 'delete', path: '/api/v1/user/telemetry-preferences', summary: 'Delete telemetry preferences (environment-controlled)', description: 'Endpoint acknowledges request but reports environment-controlled behavior rather than deleting stored preference.', security: 'mixed' },
  ];

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path === '/api/v1/feature-access' && def.method === 'post') req.body = { schema: FeatureAccessBody };
    if (def.path === '/api/v1/feature-flags' && def.method === 'post') req.body = { schema: FeatureFlagsPostBody };

    if (def.method === 'get') {
      req.query = zOpenApi.object({
        format: zOpenApi.string().optional(),
        flags: zOpenApi.string().optional(),
        period: zOpenApi.string().optional(),
        language: zOpenApi.string().optional(),
        package_name: zOpenApi.string().optional(),
        version: zOpenApi.string().optional(),
      });
    }

    return req;
  }

  function responsesFor(def: Def) {
    const responses: Record<number, any> = {
      400: { description: 'Invalid request payload/query.', schema: ApiError },
      401: { description: 'Unauthorized (API key/session auth failure depending on route).', schema: ApiError },
      403: { description: 'Permission denied.', schema: ApiError },
      500: { description: 'Unexpected route/controller failure.', schema: ApiError },
      200: { description: 'Operation succeeded.', schema: ApiSuccess },
    };

    if (def.path === '/api/v1/meta/docs') {
      responses[200] = { description: 'Swagger UI HTML or JSON redirect payload.', schema: ApiSuccess, contentType: 'text/html' };
      responses[302] = { description: 'Redirect to /api/v1/meta/openapi for non-html format.', emptyBody: true };
    }

    return responses;
  }

  for (const def of defs) {
    const extensions: Record<string, unknown> = {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'metadata',
      'x-auth-mechanism': 'x-api-key route auth',
      'x-tenant-header': 'x-tenant-id (optional)',
    };

    if (def.path === '/api/v1/feature-access') {
      extensions['x-rbac-resource'] = 'permission';
      extensions['x-auth-mechanism'] = 'x-api-key validated by ApiPermissionController.authenticate()';
    }

    if (def.path === '/api/v1/test-auth') {
      extensions['x-rbac-resource'] = 'auth';
      extensions['x-auth-mechanism'] = 'withApiKeyAuth from apiAuthMiddleware';
    }

    if (def.security === 'mixed') {
      extensions['x-session-auth-required'] = true;
      extensions['x-auth-mechanism'] = 'Session user required in handler; global /api middleware may still require x-api-key presence';
      delete extensions['x-rbac-resource'];
    }

    if (def.path.startsWith('/api/v1/meta/')) {
      extensions['x-rbac-resource'] = 'metadata';
      extensions['x-auth-mechanism'] = 'ApiMetadataController.authenticate() + metadata read permission';
    }

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: def.security === 'session' ? [] : [{ ApiKeyAuth: [] }],
      request: requestFor(def),
      responses: responsesFor(def),
      extensions,
      edition: 'both',
    });
  }
}
