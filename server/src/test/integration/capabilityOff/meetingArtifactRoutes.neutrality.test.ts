import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A2/A3 neutrality for both artifact routes. The artifacts route is served through the
 * 'meetingArtifacts' seam; the recordings route reroutes to it only when the seam handles the
 * tenant, otherwise the native recording proxy runs untouched. There is no x-api-key shortcut.
 */
const native = vi.hoisted(() => ({ hasPermission: vi.fn(async () => false), knexTouched: [] as string[], actor: vi.fn() }));

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: new Proxy(function () {}, { get(_t, p) { native.knexTouched.push(String(p)); return () => { throw new Error('knex used'); }; } }) }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  tenantDb: () => ({}),
  withTransaction: vi.fn(),
}));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: vi.fn() } }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: native.hasPermission }));
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn(), getApiKeyUserOverride: vi.fn(() => null), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' })),
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: { validateApiKeyAnyTenant: vi.fn(async () => null) } }));
vi.mock('@/lib/api/auth/meetingArtifactActor', () => ({ resolveMeetingArtifactActor: native.actor }));

import { NextRequest } from 'next/server';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { meetingArtifactSeam } from '../../../lib/online-meetings/meetingArtifactDelivery';
import { GET as getArtifact } from '../../../app/api/online-meetings/artifacts/[artifactId]/route';
import { GET as getRecording } from '../../../app/api/online-meetings/recordings/[artifactId]/route';

const ARTIFACT = '44444444-4444-4444-8444-444444444444';
const params = { params: Promise.resolve({ artifactId: ARTIFACT }) };
const request = (headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/online-meetings/x/${ARTIFACT}`, { headers });
let consume: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.FORCE_CAPABILITIES;
  resetCapabilityRegistry();
  meetingArtifactSeam.reset();
  native.hasPermission.mockClear();
  native.knexTouched.length = 0;
  native.actor.mockReset();
  native.actor.mockResolvedValue({ kind: 'session', tenant: 'tenant-1', userId: 'user-1', sessionId: 's-1' });
  consume = vi.fn(async () => ({ handled: true as const, value: new Response('artifact-bytes') as any }));
  meetingArtifactSeam.register(() => ({ consumeMeetingArtifact: consume }) as any);
});

const unserved = [
  ['Kansas', () => undefined],
  ['Emerald', () => registerCapabilityParticipation('co-managed', async () => new Set<string>())],
  ['FORCE off', () => { registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds)); process.env.FORCE_CAPABILITIES = 'co-managed:off'; clearCapabilityCache(); }],
] as const;

describe.each(unserved)('%s tenant', (_label, arrange) => {
  it('artifacts route answers 404 without calling the provider or the database', async () => {
    arrange();
    const response = await getArtifact(request(), params);
    expect(response.status).toBe(404);
    expect(consume).not.toHaveBeenCalled();
    expect(native.knexTouched).toEqual([]);
  });

  it('recordings route runs the native proxy untouched (even with an x-api-key header)', async () => {
    arrange();
    for (const headers of [{}, { 'x-api-key': 'k' }]) {
      native.hasPermission.mockClear();
      const response = await getRecording(request(headers), params);
      expect(response.status).toBe(403);
      expect(native.hasPermission).toHaveBeenCalledTimes(1);
      expect(consume).not.toHaveBeenCalled();
      expect(native.actor).not.toHaveBeenCalled();
    }
  });
});

describe('participating tenant', () => {
  beforeEach(() => registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds)));

  it('artifacts route is served by the provider', async () => {
    const response = await getArtifact(request(), params);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0][2]).toBe(ARTIFACT);
    expect(await response.text()).toBe('artifact-bytes');
  });

  it('recordings route reroutes to the provider and skips the native proxy', async () => {
    const response = await getRecording(request(), params);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(native.hasPermission).not.toHaveBeenCalled();
    expect(await response.text()).toBe('artifact-bytes');
  });

  it('an unauthenticated artifacts request is 401 and never reaches the provider', async () => {
    native.actor.mockResolvedValue(null);
    expect((await getArtifact(request(), params)).status).toBe(401);
    expect(consume).not.toHaveBeenCalled();
  });
});
