import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();

class TierAccessErrorMock extends Error {}

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
  TierAccessError: TierAccessErrorMock,
}));

const internalUser = {
  user_id: 'user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
};

async function importGuard() {
  return import('@ee/app/api/integrations/hudu/_guards');
}

describe('T001: requireHuduUiFlagEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentUserMock.mockReset();
    hasPermissionMock.mockReset();
    assertTierAccessMock.mockReset();

    // Happy-path defaults; individual tests override as needed.
    getCurrentUserMock.mockResolvedValue(internalUser);
    hasPermissionMock.mockResolvedValue(true);
    assertTierAccessMock.mockResolvedValue(undefined);
  });

  it('returns the tenant/user context when EE access is granted', async () => {
    const { requireHuduUiFlagEnabled } = await importGuard();

    const result = await requireHuduUiFlagEnabled('read');

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({ tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('returns a 403 blocked response when the integrations tier is denied', async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock('Integrations tier required'));
    const { requireHuduUiFlagEnabled } = await importGuard();

    const result = await requireHuduUiFlagEnabled('read');

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('returns a 401 when there is no authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const { requireHuduUiFlagEnabled } = await importGuard();

    const result = await requireHuduUiFlagEnabled('read');

    expect((result as Response).status).toBe(401);
  });

  it('returns a 403 when the caller lacks the required system_settings permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { requireHuduUiFlagEnabled } = await importGuard();

    const result = await requireHuduUiFlagEnabled('update');

    expect((result as Response).status).toBe(403);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
  });
});
