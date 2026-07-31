/**
 * T009 — agent publish loop API.
 *
 * (a) Registry/discovery (executable): the marketing publish-loop endpoints
 * are registered in the v1 OpenAPI registry with marketing RBAC metadata and
 * agent-discoverable descriptions, are present in the generated base OpenAPI
 * document, and appear in the MCP chat API registry (registry.generated.ts)
 * that chat agents use for endpoint discovery.
 *
 * (b) Permission/flag guard (executable): ApiMarketingController's handle()
 * pipeline — authenticate -> tenant context -> feature flag -> RBAC — is
 * exercised with the infrastructure seam mocked (API-key validation, user
 * lookup, rate limiting, product access, DB connection, RBAC hasPermission,
 * and the marketing-module feature flag). Asserts:
 *   - flag off -> 404 (not 403) on both read and manage endpoints;
 *   - marketing:read-only caller -> 200 on GET awaiting-publish, 403 on
 *     POST publish;
 *   - marketing:manage caller -> 200 on POST publish with the service
 *     receiving the target id + permalink.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerMarketingV1Routes } from '../../../lib/api/openapi/routes/marketingV1';
import { generateBaseDocument } from '../../../lib/api/openapi';
import { chatApiRegistry } from '../../../lib/mcp/registry.generated';

// ---------------------------------------------------------------------------
// T009(a) — registry / discovery
// ---------------------------------------------------------------------------

const EXPECTED_ROUTES = [
  'GET /api/v1/marketing/campaigns',
  'POST /api/v1/marketing/campaigns',
  'GET /api/v1/marketing/campaigns/{id}',
  'PUT /api/v1/marketing/campaigns/{id}',
  'GET /api/v1/marketing/campaigns/{id}/funnel',
  'GET /api/v1/marketing/content',
  'POST /api/v1/marketing/content',
  'GET /api/v1/marketing/content/{id}',
  'PUT /api/v1/marketing/content/{id}',
  'DELETE /api/v1/marketing/content/{id}',
  'GET /api/v1/marketing/channels',
  'POST /api/v1/marketing/channels',
  'PUT /api/v1/marketing/channels/{id}',
  'GET /api/v1/marketing/forms',
  'POST /api/v1/marketing/forms',
  'PUT /api/v1/marketing/forms/{id}',
  'GET /api/v1/marketing/posts/queue',
  'GET /api/v1/marketing/posts/awaiting-publish',
  'POST /api/v1/marketing/posts',
  'POST /api/v1/marketing/posts/{id}/reschedule',
  'POST /api/v1/marketing/posts/targets/{targetId}/publish',
  'POST /api/v1/marketing/posts/targets/{targetId}/skip',
  'GET /api/v1/marketing/sequences',
  'POST /api/v1/marketing/sequences',
  'GET /api/v1/marketing/sequences/{id}',
  'PUT /api/v1/marketing/sequences/{id}',
  'POST /api/v1/marketing/sequences/{id}/enroll',
  'POST /api/v1/marketing/sequences/enrollments/{enrollmentId}/unenroll',
];

describe('T009(a): marketing v1 OpenAPI registration', () => {
  it('registers every implemented endpoint with marketing RBAC + flag metadata', () => {
    const registry = createRegistry();
    registerMarketingV1Routes(registry);
    const routes = registry.getRegisteredRoutes();

    expect(routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`)).toEqual(EXPECTED_ROUTES);
    expect(routes.every((route) => route.extensions?.['x-rbac-resource'] === 'marketing')).toBe(true);
    expect(routes.every((route) => route.extensions?.['x-feature-flag'] === 'marketing-module (404 when disabled for the tenant)')).toBe(true);
    expect(routes.every((route) => route.tags?.includes('Marketing v1'))).toBe(true);
  });

  it('describes the publish loop so an agent can discover it end to end', () => {
    const registry = createRegistry();
    registerMarketingV1Routes(registry);
    const routes = registry.getRegisteredRoutes();

    const awaiting = routes.find((route) => route.path === '/api/v1/marketing/posts/awaiting-publish');
    expect(awaiting).toBeDefined();
    // The reading list must be findable by an agent searching for posts
    // "awaiting manual publish".
    expect(`${awaiting!.summary} ${awaiting!.description}`).toMatch(/awaiting manual publish/i);
    expect(awaiting!.description).toMatch(/publish loop/i);

    const publish = routes.find(
      (route) => route.method === 'post' && route.path === '/api/v1/marketing/posts/targets/{targetId}/publish',
    );
    expect(publish).toBeDefined();
    // The completion step points back at the reading list.
    expect(publish!.description).toMatch(/awaiting manual publish/i);
    expect(publish!.description).toContain('/api/v1/marketing/posts/awaiting-publish');

    const document = registry.buildDocument({
      title: 'Marketing API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(document.paths?.['/api/v1/marketing/posts/awaiting-publish']?.get).toBeDefined();
    expect(document.paths?.['/api/v1/marketing/posts/targets/{targetId}/publish']?.post).toBeDefined();
    expect(document.paths?.['/api/v1/marketing/posts/targets/{targetId}/skip']?.post).toBeDefined();

    // Wired into the shared base registry (buildBaseRegistry via generateBaseDocument).
    const baseDocument = generateBaseDocument({
      title: 'Alga API Test',
      version: '1.0.0',
      edition: 'ce',
    });
    expect(baseDocument.paths?.['/api/v1/marketing/posts/awaiting-publish']?.get).toBeDefined();
    expect(baseDocument.paths?.['/api/v1/marketing/posts/targets/{targetId}/publish']?.post).toBeDefined();
  });

  it('exposes the marketing routes in the MCP chat API registry used by chat agents', () => {
    const marketingEntries = chatApiRegistry.filter((entry) => entry.path.startsWith('/api/v1/marketing'));

    const expectedPaths = [...new Set(EXPECTED_ROUTES.map((route) => route.split(' ')[1]))];
    for (const path of expectedPaths) {
      expect(
        marketingEntries.some((entry) => entry.path === path),
        `chat registry is missing ${path}`,
      ).toBe(true);
    }

    const awaiting = marketingEntries.find((entry) => entry.path === '/api/v1/marketing/posts/awaiting-publish');
    expect(awaiting).toBeDefined();
    expect(`${awaiting!.displayName} ${awaiting!.summary} ${awaiting!.description}`).toMatch(/awaiting manual publish/i);

    const publish = marketingEntries.find(
      (entry) => entry.method === 'post' && entry.path === '/api/v1/marketing/posts/targets/{targetId}/publish',
    );
    expect(publish).toBeDefined();
    expect(publish!.description).toMatch(/awaiting manual publish/i);
  });
});

// ---------------------------------------------------------------------------
// T009(b) — permission / flag guard
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  isFeatureFlagEnabled: vi.fn(),
  validateApiKeyAnyTenant: vi.fn(),
  validateApiKeyForTenant: vi.fn(),
  findUserByIdForApi: vi.fn(),
  hasPermission: vi.fn(),
  getConnection: vi.fn(),
  enforceApiRateLimit: vi.fn(),
  getTenantProduct: vi.fn(),
  resolveProductApiBehavior: vi.fn(),
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core')>(),
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));

// MarketingService imports every marketing internal by name; the guard tests
// spy on the service layer, so the internals only need to exist.
vi.mock('@alga-psa/marketing/lib', () => ({
  MARKETING_MODULE_FLAG: 'marketing-module',
  listCampaignsInternal: vi.fn(),
  getCampaignInternal: vi.fn(),
  createCampaignInternal: vi.fn(),
  updateCampaignInternal: vi.fn(),
  getCampaignFunnelInternal: vi.fn(),
  listContentInternal: vi.fn(),
  getContentInternal: vi.fn(),
  createContentInternal: vi.fn(),
  updateContentInternal: vi.fn(),
  deleteContentInternal: vi.fn(),
  listChannelsInternal: vi.fn(),
  createChannelInternal: vi.fn(),
  updateChannelInternal: vi.fn(),
  listFormsInternal: vi.fn(),
  createFormInternal: vi.fn(),
  updateFormInternal: vi.fn(),
  createPostInternal: vi.fn(),
  reschedulePostInternal: vi.fn(),
  getQueueInternal: vi.fn(),
  getAwaitingPublishInternal: vi.fn(),
  markTargetPublishedInternal: vi.fn(),
  skipTargetInternal: vi.fn(),
  listSequencesInternal: vi.fn(),
  getSequenceDetailInternal: vi.fn(),
  createSequenceInternal: vi.fn(),
  updateSequenceInternal: vi.fn(),
  enrollContactInternal: vi.fn(),
  unenrollContactInternal: vi.fn(),
}));

vi.mock('../../../lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant,
    validateApiKeyForTenant: mocks.validateApiKeyForTenant,
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: mocks.findUserByIdForApi,
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: mocks.getConnection,
}));

vi.mock('../../../lib/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('../../../lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: mocks.enforceApiRateLimit,
}));

vi.mock('@/lib/productAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/productAccess')>(),
  getTenantProduct: mocks.getTenantProduct,
}));

vi.mock('@/lib/productSurfaceRegistry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/productSurfaceRegistry')>(),
  resolveProductApiBehavior: mocks.resolveProductApiBehavior,
}));

import { ApiMarketingController } from '../../../lib/api/controllers/ApiMarketingController';
import { MarketingService } from '../../../lib/api/services/MarketingService';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

function apiRequest(url: string, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const req = new Request(url, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': 'test-api-key',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  (req as any).params = Promise.resolve(init.params ?? {});
  return req as any;
}

describe('T009(b): ApiMarketingController flag + permission guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureFlagEnabled.mockResolvedValue(true);
    mocks.validateApiKeyAnyTenant.mockResolvedValue({
      user_id: USER_ID,
      tenant: TENANT_ID,
      api_key_id: 'api-key-1',
    });
    mocks.findUserByIdForApi.mockResolvedValue({ user_id: USER_ID, tenant: TENANT_ID });
    mocks.getConnection.mockResolvedValue({});
    mocks.enforceApiRateLimit.mockResolvedValue(null);
    mocks.getTenantProduct.mockResolvedValue('psa');
    mocks.resolveProductApiBehavior.mockReturnValue('allowed');
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('answers 404 (not 403) when the marketing-module flag is off for the tenant', async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    const controller = new ApiMarketingController();

    const readResponse = await controller.getAwaitingPublish()(apiRequest('http://localhost/api/v1/marketing/posts/awaiting-publish'));
    expect(readResponse.status).toBe(404);
    expect((await readResponse.json()).error.message).toMatch(/not enabled/i);

    const publishResponse = await controller.publishTarget()(apiRequest(
      `http://localhost/api/v1/marketing/posts/targets/${TARGET_ID}/publish`,
      { method: 'POST', body: { permalink: 'https://linkedin.com/posts/1' }, params: { targetId: TARGET_ID } },
    ));
    expect(publishResponse.status).toBe(404);

    // The flag check runs before RBAC: a denied module never leaks which
    // permission would have been required.
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith('marketing-module', {
      tenantId: TENANT_ID,
      userId: USER_ID,
    });
  });

  it('lets a marketing:read-only caller list posts awaiting manual publish', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: unknown, action: string) => action === 'read');
    const queue = [{ target_id: TARGET_ID, rendered_text: 'We shipped a thing' }];
    const serviceSpy = vi.spyOn(MarketingService.prototype, 'getAwaitingPublish').mockResolvedValue(queue as any);

    const controller = new ApiMarketingController();
    const response = await controller.getAwaitingPublish()(apiRequest('http://localhost/api/v1/marketing/posts/awaiting-publish'));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(queue);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'marketing', 'read', expect.anything());
    expect(serviceSpy).toHaveBeenCalledOnce();
    serviceSpy.mockRestore();
  });

  it('denies a marketing:read-only caller on the publish endpoint with 403', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: unknown, action: string) => action === 'read');
    const serviceSpy = vi.spyOn(MarketingService.prototype, 'markTargetPublished');

    const controller = new ApiMarketingController();
    const response = await controller.publishTarget()(apiRequest(
      `http://localhost/api/v1/marketing/posts/targets/${TARGET_ID}/publish`,
      { method: 'POST', body: { permalink: 'https://linkedin.com/posts/1' }, params: { targetId: TARGET_ID } },
    ));

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe('Permission denied: Cannot manage marketing');
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'marketing', 'manage', expect.anything());
    expect(serviceSpy).not.toHaveBeenCalled();
    serviceSpy.mockRestore();
  });

  it('lets a marketing:manage caller mark a target published with a permalink', async () => {
    const publishedTarget = {
      target_id: TARGET_ID,
      status: 'published',
      permalink: 'https://linkedin.com/posts/1',
      published_by: USER_ID,
      published_via: 'api',
    };
    const serviceSpy = vi.spyOn(MarketingService.prototype, 'markTargetPublished').mockResolvedValue(publishedTarget as any);

    const controller = new ApiMarketingController();
    const response = await controller.publishTarget()(apiRequest(
      `http://localhost/api/v1/marketing/posts/targets/${TARGET_ID}/publish`,
      { method: 'POST', body: { permalink: 'https://linkedin.com/posts/1' }, params: { targetId: TARGET_ID } },
    ));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(publishedTarget);
    expect(serviceSpy).toHaveBeenCalledWith(
      TARGET_ID,
      'https://linkedin.com/posts/1',
      expect.objectContaining({ tenant: TENANT_ID, userId: USER_ID }),
    );
    serviceSpy.mockRestore();
  });
});
