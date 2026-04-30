import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerInstallRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Extension Installs';

  const RunnerCanaryHeaders = registry.registerSchema(
    'RunnerCanaryHeaders',
    zOpenApi.object({
      'x-canary': zOpenApi.string().optional().describe('Optional runner canary identifier used only for logging and cache variance.'),
    }),
  );

  const InstallLookupByHostQuery = registry.registerSchema(
    'InstallLookupByHostQuery',
    zOpenApi.object({
      host: zOpenApi
        .string()
        .min(1)
        .describe('Runner domain hostname to resolve. The implementation lowercases the value and strips any port before matching tenant_extension_install.runner_domain.'),
    }),
  );

  const InstallLookupByHostResponse = registry.registerSchema(
    'InstallLookupByHostResponse',
    zOpenApi.object({
      tenant_id: zOpenApi.string().describe('Tenant ID from tenant_extension_install.tenant_id for the matching runner domain.'),
      extension_id: zOpenApi.string().uuid().describe('Extension registry UUID from tenant_extension_install.registry_id.'),
      content_hash: zOpenApi.string().describe('Content hash from extension_bundle.content_hash for the install version. Usually sha256:<64 hex chars>.'),
    }),
  );

  const InstallLookupErrorResponse = registry.registerSchema(
    'InstallLookupErrorResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Error message, such as missing host, not found, internal error, or middleware API-key errors.'),
    }),
  );

  const InstallValidateQuery = registry.registerSchema(
    'InstallValidateQuery',
    zOpenApi.object({
      tenant: zOpenApi.string().uuid().describe('Tenant UUID from tenant_extension_install.tenant_id.'),
      extension: zOpenApi.string().uuid().describe('Extension registry UUID from tenant_extension_install.registry_id.'),
      hash: zOpenApi
        .string()
        .min(1)
        .describe('Bundle content hash to validate. The EE action accepts sha256:<64 hex chars> or a raw 64-character hex string and normalizes raw hex to sha256: form.'),
    }),
  );

  const InstallValidateResponse = registry.registerSchema(
    'InstallValidateResponse',
    zOpenApi.object({
      valid: zOpenApi.boolean().describe('True when the hash matches a bundle for the currently installed extension version; false when validation completes but does not match.'),
    }),
  );

  const InstallValidateParameterErrorResponse = registry.registerSchema(
    'InstallValidateParameterErrorResponse',
    zOpenApi.object({
      valid: zOpenApi.literal(false).describe('Always false for parameter errors.'),
      error: zOpenApi.literal('missing or invalid parameters').describe('Returned when tenant, extension, or hash is absent.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/installs/lookup-by-host',
    summary: 'Lookup extension install by runner host',
    description:
      'Internal endpoint for extension runners. Given a runner domain, resolves the tenant, extension registry ID, and current bundle content hash needed to serve extension content. The EE implementation queries tenant_extension_install.runner_domain with an admin connection and then selects the latest extension_bundle row for the installed version. In non-EE builds the product-extension action is a stub. Requires x-api-key; the Express middleware allows the ALGA_AUTH_KEY runner secret or a valid database API key.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: InstallLookupByHostQuery,
      headers: RunnerCanaryHeaders,
    },
    responses: {
      200: {
        description: 'Install mapping found for the runner host.',
        schema: InstallLookupByHostResponse,
      },
      400: {
        description: 'The required host query parameter is missing.',
        schema: InstallLookupErrorResponse,
      },
      401: {
        description: 'x-api-key is missing or invalid at middleware.',
        schema: InstallLookupErrorResponse,
      },
      404: {
        description: 'No install or bundle was found for the runner host.',
        schema: InstallLookupErrorResponse,
      },
      500: {
        description: 'Unexpected lookup failure.',
        schema: InstallLookupErrorResponse,
      },
    },
    extensions: {
      'x-runner-internal': true,
      'x-admin-db-connection': true,
      'x-cache-control': 'no-store',
      'x-vary': 'x-api-key, x-canary',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/installs/validate',
    summary: 'Validate extension bundle content hash',
    description:
      'Internal endpoint for extension runners and deployment validation. It checks whether a supplied content hash belongs to the currently installed extension version for the supplied tenant and extension registry ID. The EE action uses an admin database connection, reads tenant_extension_install by tenant_id and registry_id, and checks extension_bundle for a matching version_id and content_hash. A negative validation result is returned as 200 with valid=false, not as 404. Requires x-api-key; the Express middleware allows the ALGA_AUTH_KEY runner secret or a valid database API key.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: InstallValidateQuery,
      headers: RunnerCanaryHeaders,
    },
    responses: {
      200: {
        description: 'Validation completed. valid=false means the hash did not match, the install was not found, or the hash format was invalid at the action layer.',
        schema: InstallValidateResponse,
      },
      400: {
        description: 'Required tenant, extension, or hash query parameter is missing.',
        schema: InstallValidateParameterErrorResponse,
      },
      401: {
        description: 'x-api-key is missing or invalid at middleware.',
        schema: InstallLookupErrorResponse,
      },
      500: {
        description: 'Unexpected validation failure. The EE handler returns valid=false for internal exceptions.',
        schema: InstallValidateResponse,
      },
    },
    extensions: {
      'x-runner-internal': true,
      'x-admin-db-connection': true,
      'x-cache-control': 'no-store',
      'x-vary': 'x-api-key, x-canary',
    },
    edition: 'both',
  });
}
