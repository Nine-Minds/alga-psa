import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rbac: true, record: null as unknown, allowed: true }));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'u1', tenant: 't1', user_type: 'internal' })),
}));
vi.mock('@/lib/api/middleware/runWithApiKeyOrSession', () => ({
  runWithApiKeyOrSession: async (_r: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord() {
      return state.record;
    }
  },
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => state.rbac) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async () => state.allowed),
}));

const { guardAssetReadForRequest } = await import('@/lib/api/controllers/assetReadGuard');

beforeEach(() => {
  state.rbac = true;
  state.record = { id: 'a1' };
  state.allowed = true;
});

describe('guardAssetReadForRequest (software / notes routes)', () => {
  it('passes for a permitted caller', async () => {
    expect(await guardAssetReadForRequest(new Request('http://x'), 'a1')).toBeNull();
  });
  it('403s without asset:read', async () => {
    state.rbac = false;
    expect((await guardAssetReadForRequest(new Request('http://x'), 'a1'))?.status).toBe(403);
  });
  it('404s when missing and when record-level denied', async () => {
    state.record = null;
    expect((await guardAssetReadForRequest(new Request('http://x'), 'a1'))?.status).toBe(404);
    state.record = { id: 'a1' };
    state.allowed = false;
    expect((await guardAssetReadForRequest(new Request('http://x'), 'a1'))?.status).toBe(404);
  });
});
