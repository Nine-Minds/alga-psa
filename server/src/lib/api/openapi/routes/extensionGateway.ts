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
          'unauthenticated',
          'invalid_session',
          'tenant_mismatch',
          'extension_not_available',
          'endpoint_not_found',
          'forbidden',
          'rate_limited',
          'not_installed',
          'payload_too_large',
          'bad_gateway',
          'access_policy_unavailable',
        ])
        .describe('Gateway-level error code. Runner and install internals are never returned to callers; upstream failures surface as a generic bad_gateway carrying only the request ID.'),
      requestId: zOpenApi
        .string()
        .optional()
        .describe('Correlates the response with server-side gateway logs.'),
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
      401: {
        description: 'No authenticated session, or the session is missing a tenant.',
        schema: ExtensionGatewayErrorResponse,
      },
      403: {
        description: 'A tenant header conflicts with the authenticated session tenant.',
        schema: ExtensionGatewayErrorResponse,
      },
      404: {
        description: 'Extension is not installed or not enabled for the session tenant.',
        schema: ExtensionGatewayErrorResponse,
      },
      500: {
        description: 'Another internal gateway error occurred.',
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

  const extensionGatewayAccessPosture =
    'The gateway fails closed unless the caller has an authenticated session principal whose tenant matches the resolved tenant. It requires an active tenant-owned install (is_enabled true and status enabled), a declared endpoint on the installed version that matches the effective method and path, the extension:read permission for GET/HEAD requests or the extension:write permission for POST/PUT/PATCH/DELETE requests for MSP users, or an explicit client-portal opt-in with a resolvable client for client users, an available rate-limit budget for the tenant and extension, and a durable execution audit record. Header-only tenant resolution and DEV_TENANT_ID never authorize execution. Runner and install internals are never returned to callers.';

  registerGatewayMethod(
    'get',
    'Forward GET request to extension runner',
    `Tenant-scoped extension gateway endpoint that forwards GET requests to an installed extension runner. The gateway requires an authenticated session and derives the tenant from that session, then forwards selected headers and all query parameters to RUNNER_BASE_URL /v1/execute and relays the runner response. ${extensionGatewayAccessPosture} Tenant-selection headers are not accepted as authentication and a header that disagrees with the session tenant fails closed. GET requests do not read a body and do not generate an idempotency key.`,
  );

  registerGatewayMethod(
    'post',
    'Forward POST request to extension runner',
    `Tenant-scoped extension gateway endpoint that forwards POST requests to an installed extension runner. The gateway requires an authenticated session and derives the tenant from that session, then forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute and relays the runner response. ${extensionGatewayAccessPosture} Tenant-selection headers are not accepted as authentication and a header that disagrees with the session tenant fails closed. For POST requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. An x-idempotency-key header is forwarded when supplied, otherwise the generated x-request-id is used as the non-GET idempotency fallback.`,
  );

  registerGatewayMethod(
    'put',
    'Forward PUT request to extension runner',
    `Tenant-scoped extension gateway endpoint that forwards PUT requests to an installed extension runner. The gateway requires an authenticated session and derives the tenant from that session, then forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute and relays the runner response. ${extensionGatewayAccessPosture} Tenant-selection headers are not accepted as authentication and a header that disagrees with the session tenant fails closed. For PUT requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. Clients should provide x-idempotency-key for safe retries; otherwise the gateway falls back to a generated request ID.`,
  );

  registerGatewayMethod(
    'patch',
    'Forward PATCH request to extension runner',
    `Tenant-scoped extension gateway endpoint that forwards PATCH requests to an installed extension runner. The gateway requires an authenticated session and derives the tenant from that session, then forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute and relays the runner response. ${extensionGatewayAccessPosture} Tenant-selection headers are not accepted as authentication and a header that disagrees with the session tenant fails closed. For PATCH requests the body is limited to 10 MB, base64-encoded, and forwarded as http.body_b64. Clients should provide x-idempotency-key for safe retries; otherwise the gateway falls back to a generated request ID. The gateway does not interpret PATCH semantics; partial-update behavior is extension-defined.`,
  );

  registerGatewayMethod(
    'delete',
    'Forward DELETE request to extension runner',
    `Tenant-scoped extension gateway endpoint that forwards DELETE requests to an installed extension runner. The gateway requires an authenticated session and derives the tenant from that session, then forwards selected headers, query parameters, and an optional opaque body to RUNNER_BASE_URL /v1/execute and relays the runner response. ${extensionGatewayAccessPosture} Tenant-selection headers are not accepted as authentication and a header that disagrees with the session tenant fails closed. For DELETE requests the body, if present, is limited to 10 MB, base64-encoded, and forwarded as http.body_b64.`,
  );
}
