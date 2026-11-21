import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IPermission, IRoleWithPermissions, IUser } from '../../interfaces/auth.interfaces';

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn(),
  },
}));

// Import after mocking
import UserModel from '@alga-psa/db/models/user';
import { hasPermission } from '../../lib/auth/rbac';
import { assertProviderMutationAuthority, ProviderMutationForbiddenError } from '../../lib/email/providerMutationAuthority';

describe('Client permission resource mapping', () => {
  const tenantId = 'test-tenant';
  const user: IUser = {
    user_id: 'user-1',
    tenant: tenantId,
    username: 'user@example.com',
    first_name: 'User',
    last_name: 'Example',
    email: 'user@example.com',
    user_type: 'internal',
    is_inactive: false,
  } as IUser;

  const clientCreatePermission: IPermission = {
    permission_id: 'perm-1',
    resource: 'client',
    action: 'create',
    tenant: tenantId,
    msp: true,
    client: false,
  };

  const roleWithClientPermissions: IRoleWithPermissions = {
    role_id: 'role-1',
    role_name: 'Admin',
    description: 'Admin role',
    tenant: tenantId,
    permissions: [clientCreatePermission],
    msp: true,
    client: false,
  };

  beforeEach(() => {
    vi.mocked(UserModel.getUserRolesWithPermissions).mockResolvedValue([roleWithClientPermissions]);
  });

  it('should grant create access when using the resource label expected by permissions (client)', async () => {
    await expect(hasPermission(user, 'client', 'create', {} as any)).resolves.toBe(true);
  });

  it('should also grant access when the controller requests the client resource alias', async () => {
    await expect(hasPermission(user, 'client', 'create', {} as any)).resolves.toBe(true);
  });

  it('can resolve a client-scoped update permission while provider mutation authority still rejects the client', async () => {
    const clientUser = { ...user, user_type: 'client' } as IUser;
    const clientPermission: IPermission = {
      permission_id: 'perm-ticket-settings-update-client',
      resource: 'ticket_settings',
      action: 'update',
      tenant: tenantId,
      msp: false,
      client: true,
    };
    const clientRole: IRoleWithPermissions = {
      ...roleWithClientPermissions,
      role_id: 'role-client-oauth-fixture',
      role_name: 'Disposable client OAuth fixture',
      msp: false,
      client: true,
      permissions: [clientPermission],
    };
    vi.mocked(UserModel.getUserRolesWithPermissions).mockResolvedValue([clientRole]);

    await expect(hasPermission(clientUser, 'ticket_settings', 'update', {} as any)).resolves.toBe(true);
    await expect(assertProviderMutationAuthority(clientUser, {} as any))
      .rejects.toBeInstanceOf(ProviderMutationForbiddenError);
  });
});
