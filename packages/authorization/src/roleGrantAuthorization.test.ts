import { beforeEach, describe, expect, it, vi } from 'vitest';

const actorRoles = vi.hoisted(() => vi.fn());
const targetRoles = vi.hoisted(() => [] as Array<{ role_id: string; msp: boolean }>);
const targetPermissions = vi.hoisted(() => [] as Array<{ role_id: string; resource: string; action: string }>);

vi.mock('@alga-psa/db/models/user', () => ({
  default: { getUserRolesWithPermissions: actorRoles },
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      if (name === 'roles') return {
        whereIn: (_column: string, ids: string[]) => ({
          select: async () => targetRoles.filter((role) => ids.includes(role.role_id)),
        }),
      };
      if (name === 'role_permissions as rp') return {
        whereIn: (_column: string, ids: string[]) => ({
          where: () => ({
            select: () => ({
              then: (resolve: (rows: unknown[]) => unknown) => resolve(targetPermissions.filter((permission) => ids.includes(permission.role_id))),
            }),
          }),
        }),
      };
      throw new Error(`Unexpected table ${name}`);
    },
    tenantJoin: () => undefined,
  }),
}));

import { assertMspRoleGrantsWithinActorPermissions } from './roleGrantAuthorization';

describe('MSP role grant authorization', () => {
  beforeEach(() => {
    actorRoles.mockReset();
    targetRoles.splice(0);
    targetPermissions.splice(0);
  });

  it('rejects a role containing a permission the actor lacks', async () => {
    targetRoles.push({ role_id: 'admin', msp: true });
    targetPermissions.push({ role_id: 'admin', resource: 'system', action: 'admin' });
    actorRoles.mockResolvedValue([{ msp: true, permissions: [{ msp: true, resource: 'user', action: 'invite' }] }]);

    await expect(assertMspRoleGrantsWithinActorPermissions('actor', 'tenant', {} as any, ['admin']))
      .rejects.toThrow(/Cannot assign an MSP role/);
  });

  it('allows a role whose MSP permissions are all held by the actor', async () => {
    targetRoles.push({ role_id: 'eligible', msp: true });
    targetPermissions.push({ role_id: 'eligible', resource: 'ticket', action: 'read' });
    actorRoles.mockResolvedValue([{ msp: true, permissions: [{ msp: true, resource: 'ticket', action: 'read' }] }]);

    await expect(assertMspRoleGrantsWithinActorPermissions('actor', 'tenant', {} as any, ['eligible']))
      .resolves.toBeUndefined();
  });

  it('does not treat client-only grants on the actor as MSP authority', async () => {
    targetRoles.push({ role_id: 'msp-role', msp: true });
    targetPermissions.push({ role_id: 'msp-role', resource: 'ticket', action: 'read' });
    actorRoles.mockResolvedValue([{ msp: true, permissions: [{ msp: false, resource: 'ticket', action: 'read' }] }]);

    await expect(assertMspRoleGrantsWithinActorPermissions('actor', 'tenant', {} as any, ['msp-role']))
      .rejects.toThrow(/Cannot assign an MSP role/);
  });
});
