import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/** The 15 seed tokens a theme pair is authored in; the app derives its ramps from them. */
const SeedTokenKeys = [
  'background',
  'card',
  'surface',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'border',
  'borderStrong',
  'primary',
  'secondary',
  'accent',
  'sidebarBg',
  'sidebarText',
  'sidebarHover',
  'headerBg',
] as const;

export function registerMobileCapabilitiesV1Routes(registry: ApiOpenApiRegistry) {
  const SeedTokens = registry.registerSchema(
    'MobileThemeSeedTokensV1',
    zOpenApi.object(
      Object.fromEntries(
        SeedTokenKeys.map((key) => [key, zOpenApi.string().describe('6-digit hex color, e.g. #8a4dea')]),
      ) as Record<(typeof SeedTokenKeys)[number], ReturnType<typeof zOpenApi.string>>,
    ),
  );
  const CapabilitiesSuccess = registry.registerSchema(
    'MobileCapabilitiesSuccessV1',
    zOpenApi.object({
      data: zOpenApi.object({
        features: zOpenApi.object({
          inventory: zOpenApi.boolean(),
          opportunities: zOpenApi.boolean(),
          opportunitiesCreate: zOpenApi.boolean(),
        }),
        theme: zOpenApi.object({
          pairId: zOpenApi.string().describe("Tenant theme pair id, e.g. 'forest' or 'custom'."),
          label: zOpenApi.string().describe("English pair name; 'Custom' for a tenant-authored pair."),
          light: SeedTokens,
          dark: SeedTokens,
          version: zOpenApi.string().describe('Stable hash of pairId plus both token sets.'),
        }).describe('Tenant theme pair the mobile app renders; always present, defaults to Alga.'),
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
      'x-rbac-resource': 'inventory/read and opportunities/read/create',
    },
    edition: 'both',
  });
}
