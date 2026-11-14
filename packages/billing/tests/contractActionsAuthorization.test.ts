import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  user: { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' as string | undefined },
}));
const database = vi.hoisted(() => ({ knex: vi.fn() }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: database.knex }),
}));
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: unknown[]) =>
    action(auth.user, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn() }));

import { hasPermission } from '@alga-psa/auth/rbac';
import { createContract, getContracts, updateContract } from '../src/actions/contractActions';

const routes = [
  { permission: 'read', invoke: () => getContracts() },
  { permission: 'create', invoke: () => createContract({ contract_name: 'Unauthorized' } as any) },
  { permission: 'update', invoke: () => updateContract('contract-1', { contract_name: 'Unauthorized' }) },
];

describe('contract action billing permissions', () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
  });

  it.each(routes)('requires billing:$permission before querying contracts', async ({ permission, invoke }) => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    expect(await invoke()).toHaveProperty('permissionError');
    expect(hasPermission).toHaveBeenCalledWith(auth.user, 'billing', permission, undefined);
    expect(database.knex).not.toHaveBeenCalled();
  });

  describe.each([
    { name: 'a client Admin', tenant: 'tenant-1', userType: 'client' },
    { name: 'an MSP from another tenant', tenant: 'tenant-2', userType: 'internal' },
    { name: 'an untyped principal', tenant: 'tenant-1', userType: undefined },
  ])('$name', ({ tenant, userType }) => {
    it.each(routes)('cannot use the $permission route even with auth bypass', async ({ invoke }) => {
      auth.user.tenant = tenant;
      auth.user.user_type = userType;
      vi.stubEnv('E2E_AUTH_BYPASS', 'true');
      vi.mocked(hasPermission).mockResolvedValue(true);

      expect(await invoke()).toHaveProperty('permissionError');
      expect(hasPermission).not.toHaveBeenCalled();
      expect(database.knex).not.toHaveBeenCalled();
    });
  });
});
