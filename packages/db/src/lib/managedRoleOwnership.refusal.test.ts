import { describe, expect, it, vi } from 'vitest';

vi.mock('./tenantDb', () => ({
  tenantDb: () => ({ table: () => ({ whereNotNull: () => ({ select: async () => [] }) }) }),
}));

import { admitManagedRoleWrite, registerManagedRoleRefusal } from './managedRoleOwnership';

const insertManaged = () => admitManagedRoleWrite({
  conn: {} as never, tenant: 't1', table: 'roles', method: 'insert',
  insert: { role_id: 'r1', role_name: 'Anything', managed_by: 'some-owner' }, rootAlias: 'roles',
});

describe('managed role refusal', () => {
  it('fails closed with a dependency-free refusal when no factory is registered', async () => {
    const error = await insertManaged().then(() => undefined, (e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ManagedRoleOwnershipError', statusCode: 409, code: 'MANAGED_ROLE_DEFINITION', owner: 'some-owner', roleIds: [] });
  });

  it('throws what the registered factory builds', async () => {
    const built = new Error('custom');
    registerManagedRoleRefusal(() => built);
    await expect(insertManaged()).rejects.toBe(built);
  });
});
