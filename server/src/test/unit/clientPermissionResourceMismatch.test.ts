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
});
