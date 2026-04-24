import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerExtensionGatewayRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Extension Gateway';

  const ExtensionGatewayParams = registry.registerSchema(
    'ExtensionGatewayParams',
    zOpenApi.object({
      extensionId: zOpenApi
        .string()
        .min(1)
        .describe('Extension identifier from the URL. This may be a registry/install UUID or a publisher.name slug, resolved case-insensitively.'),
      path: zOpenApi
        .string()
        .optional()
        .describe('Remaining extension endpoint path after extensionId. The gateway forwards this path to the runner unchanged.'),
    }),
  );

  const ExtensionGatewayHeaders = registry.registerSchema(
    'ExtensionGatewayHeaders',
    zOpenApi.object({
      'x-request-id': zOpenApi
        .string()
        .uuid()
        .optional()
        .describe('Optional request ID. The gateway generates a UUID when absent and forwards it to the runner.'),
      'x-idempotency-key': zOpenApi
        .string()
        .optional()
        .describe('Optional idempotency key for non-GET methods. The gateway falls back to x-request-id when absent and forwards the key to the runner.'),
      'x-alga-tenant': zOpenApi
        .string()
        .optional()
        .describe('Internal tenant header used for tenant resolution before session fallback.'),
      'x-tenant-id': zOpenApi
        .string()
        .optional()
        .describe('Legacy tenant header accepted for tenant resolution before session fallback.'),
    }),
  );

  const ExtensionOpaqueRequest = registry.registerSchema(
    'ExtensionOpaqueRequest',
    zOpenApi
      .object({})
      .passthrough()
      .describe('Extension-specific request body. The gateway treats this as opaque, enforces a 10 MB limit for non-GET methods, base64-encodes it, and forwards it to the extension runner.'),
  );

  const ExtensionOpaqueResponse = registry.registerSchema(
    'ExtensionOpaqueResponse',
    zOpenApi
      .object({})
      .passthrough()
      .describe('Extension-specific response relayed from the runner. Status code, content type, and body are controlled by the extension.'),
  );

  const ExtensionGatewayErrorResponse = registry.registerSchema(
    'ExtensionGatewayErrorResponse',
    zOpenApi.object({
      error: zOpenApi
        .enum([
          'not_installed',
          'payload_too_large',
          'install_context_missing',
          'runner_empty_response',
          'runner_invalid_response',
          'bad_gateway',
          'internal_error',
        ])
        .describe('Gateway-level error code.'),
      detail: zOpenApi.unknown().optional().describe('Additional error detail when available.'),
    }),
  );

  function registerGatewayMethod(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    summary: string,
    description: string,
  ) {
    const responses: Record<string, any> = {
      200: {
        description: 'Runner response relayed by the gateway. The actual status can vary by extension contract.',
        schema: ExtensionOpaqueResponse,
      },
      204: {
        description: 'Runner returned no content, or CORS preflight for OPTIONS requests on this gateway path.',
        emptyBody: true,
      },
      404: {
        description: 'Extension is not installed or not enabled for the resolved tenant.',
        schema: ExtensionGatewayErrorResponse,
      },
      500: {
        description: 'Tenant could not be resolved or another internal gateway error occurred.',
        schema: ExtensionGatewayErrorResponse,
      },
      502: {
        description: 'Runner call failed, runner response was empty/invalid, or install context was incomplete.',
        schema: ExtensionGatewayErrorResponse,
      },
    };

    if (method !== 'get') {
      responses[413] = {
        description: 'Request body exceeds the 10 MB gateway limit.',
        schema: ExtensionGatewayErrorResponse,
      };
    }

    registry.registerRoute({
      method,
      path: '/api/ext/{extensionId}/{path}',
      summary,
      description,
      tags: [tag],
      security: [{ SessionCookieAuth: [] }],
      request: {
        params: ExtensionGatewayParams,
        headers: ExtensionGatewayHeaders,
        ...(method === 'get'
          ? {}
          : {
              body: {
                schema: ExtensionOpaqueRequest,
                description: `Optional extension-specific ${method.toUpperCase()} body. The gateway accepts any content type up to 10 MB and forwards it as base64.`,
                required: false,
              },
            }),
      },
      responses,
      extensions: {
        'x-api-key-auth-skipped': true,
        'x-proxy-target': 'extension-runner',
        ...(method === 'get'
          ? { 'x-request-body-read': false, 'x-idempotency-generated': false }
          : {
              'x-max-body-bytes': 10485760,
              'x-idempotency-supported': true,
              'x-idempotency-key-header': 'x-idempotency-key',
              'x-idempotency-fallback': 'x-request-id',
            }),
      },
      edition: 'both',
    });
  }

  registerGatewayMethod(
    'get',
    'Forward GET request to extension runner',
    'Tenant-scoped extension gateway endpoint that forwards GET requests to an installed extension runner. The gateway resolves the tenant from x-alga-tenant, x-tenant-id, session cookie, or DEV_TENANT_ID in development; verifies the extension is installed and enabled for that tenant; forwards selected headers and all query parameters to RUNNER_BASE_URL /v1/execute; and relays the runner response. GET requests do not read a body and do not generate an idempotency key. The gateway currently has a placeholder access check and does not enforce per-extension RBAC beyond tenant install resolution.',
  );

  registerGatewayMethod(
    'post',
    'Forward POST request to extension runner',
    'Tenant-scoped extension gateway endpoint that forwards POST requests to an installed extension runner. The gateway resolves the tenant from x-alga-tenant, x-tenant-id, session cookie, or DEV_TENANT_ID in development; verifies the extension is installed and enabled for that tenant; forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute; and relays the runner response. For POST requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. An x-idempotency-key header is forwarded when supplied, otherwise the generated x-request-id is used as the non-GET idempotency fallback. The gateway currently has a placeholder access check and does not enforce per-extension RBAC beyond tenant install resolution.',
  );

  registerGatewayMethod(
    'put',
    'Forward PUT request to extension runner',
    'Tenant-scoped extension gateway endpoint that forwards PUT requests to an installed extension runner. The gateway resolves the tenant from x-alga-tenant, x-tenant-id, session cookie, or DEV_TENANT_ID in development; verifies the extension is installed and enabled for that tenant; forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute; and relays the runner response. For PUT requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. Clients should provide x-idempotency-key for safe retries; otherwise the gateway falls back to a generated request ID. The gateway currently has a placeholder access check and does not enforce per-extension RBAC beyond tenant install resolution.',
  );

  registerGatewayMethod(
    'patch',
    'Forward PATCH request to extension runner',
    'Tenant-scoped extension gateway endpoint that forwards PATCH requests to an installed extension runner. The gateway resolves the tenant from x-alga-tenant, x-tenant-id, session cookie, or DEV_TENANT_ID in development; verifies the extension is installed and enabled for that tenant; forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute; and relays the runner response. For PATCH requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. Clients should provide x-idempotency-key for safe retries; otherwise the gateway falls back to a generated request ID. The gateway does not interpret PATCH semantics; partial-update behavior is extension-defined.',
  );

  registerGatewayMethod(
    'delete',
    'Forward DELETE request to extension runner',
    'Tenant-scoped extension gateway endpoint that forwards DELETE requests to an installed extension runner. The gateway resolves the tenant from x-alga-tenant, x-tenant-id, session cookie, or DEV_TENANT_ID in development; verifies the extension is installed and enabled for that tenant; forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute; and relays the runner response. For DELETE requests the body, if present, is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. The gateway currently has a placeholder access check and does not enforce per-extension RBAC beyond tenant install resolution.',
  );
}
