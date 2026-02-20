import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

describe('Entra direct connect action permissions', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
  });

  it('T031: direct connect initiation rejects users lacking update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { initiateEntraDirectOAuth } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await initiateEntraDirectOAuth(
      { user_id: 'user-1', user_type: 'internal' } as any,
      { tenant: 'tenant-1' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to configure Entra integration',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'system_settings',
      'update'
    );
  });
});
