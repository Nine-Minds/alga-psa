import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  listUserApiKeys: vi.fn(),
  deactivateApiKey: vi.fn(),
  listAllApiKeys: vi.fn(),
  adminDeactivateApiKey: vi.fn(),
  getUserRoles: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  ApiKeyService: {
    createApiKey: mocks.createApiKey,
    listUserApiKeys: mocks.listUserApiKeys,
    deactivateApiKey: mocks.deactivateApiKey,
    listAllApiKeys: mocks.listAllApiKeys,
    adminDeactivateApiKey: mocks.adminDeactivateApiKey,
  },
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getUserRoles: mocks.getUserRoles,
}));

// withAuth simply returns the inner action so tests can invoke it directly
// with a chosen user/context.
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => action,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ permissionError: message }),
  actionError: (message: string) => ({ actionError: message }),
}));

import {
  adminDeactivateApiKey,
  adminListApiKeys,
  createApiKey,
  deactivateApiKey,
  listApiKeys,
} from '../apiKeyActions';

// withAuth is mocked to return the raw action, so tests can drive the action
// with an explicit user + context. The real wrapper type expects only the
// trailing args, so the action functions are invoked through a callable alias.
type RawAction = (user: any, ctx: any, ...args: any[]) => Promise<any>;
const rawCreateApiKey = createApiKey as unknown as RawAction;
const rawListApiKeys = listApiKeys as unknown as RawAction;
const rawDeactivateApiKey = deactivateApiKey as unknown as RawAction;
const rawAdminListApiKeys = adminListApiKeys as unknown as RawAction;
const rawAdminDeactivateApiKey = adminDeactivateApiKey as unknown as RawAction;

const clientUser = {
  user_id: 'client-user-1',
  user_type: 'client',
  tenant: 'tenant-1',
  email: 'client@example.com',
  is_inactive: false,
};

const internalUser = {
  user_id: 'internal-user-1',
  user_type: 'internal',
  tenant: 'tenant-1',
  email: 'internal@example.com',
  is_inactive: false,
};

const ctx = { tenant: 'tenant-1' };

describe('apiKeyActions internal-user guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRoles.mockResolvedValue([
      { role_id: 'role-admin', role_name: 'Admin', msp: true, client: false },
    ]);
  });

  it('denies a client user before any key-service call for create/list/deactivate', async () => {
    const createResult = await rawCreateApiKey(clientUser, ctx, 'desc', '2030-01-01');
    expect(createResult).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.createApiKey).not.toHaveBeenCalled();

    const listResult = await rawListApiKeys(clientUser, ctx);
    expect(listResult).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.listUserApiKeys).not.toHaveBeenCalled();

    const deactivateResult = await rawDeactivateApiKey(clientUser, ctx, 'key-1');
    expect(deactivateResult).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.listUserApiKeys).not.toHaveBeenCalled();
    expect(mocks.deactivateApiKey).not.toHaveBeenCalled();
  });

  it('denies a client user even when the client role is admin-like, without a role lookup or data mutation', async () => {
    const adminListResult = await rawAdminListApiKeys(clientUser, ctx);
    expect(adminListResult).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.getUserRoles).not.toHaveBeenCalled();
    expect(mocks.listAllApiKeys).not.toHaveBeenCalled();

    const adminDeactivateResult = await rawAdminDeactivateApiKey(clientUser, ctx, 'key-1');
    expect(adminDeactivateResult).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.getUserRoles).not.toHaveBeenCalled();
    expect(mocks.adminDeactivateApiKey).not.toHaveBeenCalled();
  });

  it('denies a client user before expiry parsing (client wins over input validation)', async () => {
    const result = await rawCreateApiKey(clientUser, ctx, 'desc', 'not-a-date');
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it('keeps internal create/list/deactivate behavior and result shapes', async () => {
    const keyView = {
      api_key_id: 'key-1',
      api_key: 'plaintext',
      description: 'desc',
      created_at: new Date(),
      expires_at: null,
      purpose: 'general',
      metadata: null,
      usage_limit: null,
      usage_count: 0,
    };
    mocks.createApiKey.mockResolvedValue(keyView);

    const created = await rawCreateApiKey(internalUser, ctx, 'desc');
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      'internal-user-1',
      'desc',
      undefined,
      { tenantId: 'tenant-1' }
    );
    expect(created).toEqual({
      api_key_id: 'key-1',
      api_key: 'plaintext',
      description: 'desc',
      created_at: expect.any(Date),
      expires_at: null,
      purpose: 'general',
      metadata: null,
      usage_limit: null,
      usage_count: 0,
    });

    mocks.listUserApiKeys.mockResolvedValue([{ ...keyView, active: true }]);
    const listed = await rawListApiKeys(internalUser, ctx);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ api_key_id: 'key-1', active: true });
    expect(listed[0]).not.toHaveProperty('api_key');

    mocks.listUserApiKeys.mockResolvedValue([{ api_key_id: 'key-1' }]);
    mocks.deactivateApiKey.mockResolvedValue(undefined);
    await expect(rawDeactivateApiKey(internalUser, ctx, 'key-1')).resolves.toEqual({ deactivated: true });
    expect(mocks.deactivateApiKey).toHaveBeenCalledWith('key-1', 'tenant-1');
  });

  it('keeps internal admin list/deactivate behavior', async () => {
    mocks.listAllApiKeys.mockResolvedValue([
      {
        api_key_id: 'key-1',
        username: 'internal-user-1',
        first_name: 'I',
        last_name: 'U',
        description: null,
        created_at: new Date(),
        last_used_at: null,
        expires_at: null,
        purpose: 'general',
        metadata: null,
        usage_limit: null,
        usage_count: 0,
        active: true,
      },
    ]);
    const adminList = await rawAdminListApiKeys(internalUser, ctx);
    expect(mocks.getUserRoles).toHaveBeenCalledWith('internal-user-1');
    expect(adminList).toHaveLength(1);
    expect((adminList as any[])[0]).toMatchObject({ username: 'internal-user-1', active: true });
    expect((adminList as any[])[0]).not.toHaveProperty('api_key');

    mocks.adminDeactivateApiKey.mockResolvedValue(undefined);
    await expect(rawAdminDeactivateApiKey(internalUser, ctx, 'key-1')).resolves.toEqual({ deactivated: true });
    expect(mocks.adminDeactivateApiKey).toHaveBeenCalledWith('key-1', 'tenant-1');
  });
});
