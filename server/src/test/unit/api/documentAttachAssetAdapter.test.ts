import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  update: true,
  read: true,
  record: null as unknown,
  allowed: true,
  loader: vi.fn(),
}));

vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(...args: unknown[]) {
      state.loader(...args);
      return state.record;
    }
  },
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, _r: string, action: string) =>
    action === 'update' ? state.update : state.read),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  projectApiResourceRead: vi.fn(async (input: { record: object }) => (state.allowed ? input.record : null)),
}));
vi.mock('@/lib/productAccess', () => ({ ProductAccessError: class extends Error {}, getTenantProduct: vi.fn() }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn() }));

const { ENTITY_ADAPTERS } = await import('@/lib/api/services/documents/entityAdapters');
const { projectApiResourceRead } = await import('@/lib/api/controllers/authorizationKernel');

const request = {
  context: { tenant: 't1', user: { user_id: 'u1' }, userId: 'u1', apiKeyId: 'k1' },
} as any;
const attach = () => ENTITY_ADAPTERS.asset.assertCanAttach(request, 'a1', {} as any);

beforeEach(() => {
  state.update = true;
  state.read = true;
  state.record = { id: 'a1' };
  state.allowed = true;
  state.loader.mockClear();
  vi.mocked(projectApiResourceRead).mockClear();
});

describe('ENTITY_ADAPTERS.asset.assertCanAttach', () => {
  it('passes for update + readable record, forwarding the API-key identity', async () => {
    await expect(attach()).resolves.toBeUndefined();
    expect(projectApiResourceRead).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'k1', kind: 'asset', tenant: 't1' }),
    );
  });

  it('403s without asset:update before loading or calling the kernel', async () => {
    state.update = false;
    await expect(attach()).rejects.toMatchObject({ message: 'Permission denied: Cannot update asset' });
    expect(state.loader).not.toHaveBeenCalled();
    expect(projectApiResourceRead).not.toHaveBeenCalled();
  });

  it('404s Asset not found when the record-level check denies', async () => {
    state.allowed = false;
    await expect(attach()).rejects.toMatchObject({ message: 'Asset not found', statusCode: 404 });
  });

  it('404s the identical error when the asset does not exist', async () => {
    state.record = null;
    await expect(attach()).rejects.toMatchObject({ message: 'Asset not found', statusCode: 404 });
    expect(projectApiResourceRead).not.toHaveBeenCalled();
  });
});
