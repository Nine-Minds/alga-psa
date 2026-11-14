import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ createTenantKnex: vi.fn(async () => ({ knex: {} })) }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'read-only-user' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => resource === 'settings' && action === 'read'),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: h.createTenantKnex,
  resolveEffectiveTimeZone: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
}));

import { updateNumberSettings } from './numberingActions';

describe('number settings mutation authorization', () => {
  it('requires settings:update inside the server mutation', async () => {
    await expect(updateNumberSettings('ASSET', { padding_length: 6 })).rejects.toThrow('Permission denied');
    expect(h.createTenantKnex).not.toHaveBeenCalled();
  });
});
