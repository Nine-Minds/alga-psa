import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveEntraPartnerConnectionMock = vi.fn();
const updateEntraConnectionValidationMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();

vi.mock('@enterprise/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: getActiveEntraPartnerConnectionMock,
  updateEntraConnectionValidation: updateEntraConnectionValidationMock,
}));

vi.mock('@enterprise/lib/integrations/entra/auth/tokenStore', () => ({
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

import { invalidateEntraDirectConnectionOnRebind } from '@alga-psa/integrations/lib/entraBindingInvalidation';

describe('invalidateEntraDirectConnectionOnRebind', () => {
  beforeEach(() => {
    getActiveEntraPartnerConnectionMock.mockReset();
    updateEntraConnectionValidationMock.mockReset();
    clearEntraDirectTokenSetMock.mockReset();
  });

  it('clears the direct token set and marks the connection reconnect-required when the profile changes', async () => {
    getActiveEntraPartnerConnectionMock.mockResolvedValue({ connection_type: 'direct', is_active: true });

    await invalidateEntraDirectConnectionOnRebind({
      tenant: 'tenant-1',
      previousProfileId: 'profile-a',
      nextProfileId: 'profile-b',
    });

    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-1');
    expect(updateEntraConnectionValidationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-1',
        connectionType: 'direct',
        status: 'validation_failed',
        snapshot: expect.objectContaining({ code: 'profile_rebound' }),
      })
    );
  });

  it('invalidates on the first bind too: existing tokens were minted by a different app', async () => {
    getActiveEntraPartnerConnectionMock.mockResolvedValue({ connection_type: 'direct', is_active: true });

    await invalidateEntraDirectConnectionOnRebind({
      tenant: 'tenant-1',
      previousProfileId: null,
      nextProfileId: 'profile-a',
    });

    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-1');
    expect(updateEntraConnectionValidationMock).toHaveBeenCalled();
  });

  it('does nothing on a no-op re-save of the same profile', async () => {
    await invalidateEntraDirectConnectionOnRebind({
      tenant: 'tenant-1',
      previousProfileId: 'profile-a',
      nextProfileId: 'profile-a',
    });

    expect(getActiveEntraPartnerConnectionMock).not.toHaveBeenCalled();
    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(updateEntraConnectionValidationMock).not.toHaveBeenCalled();
  });

  it('does nothing when the tenant has no active direct connection', async () => {
    getActiveEntraPartnerConnectionMock.mockResolvedValue(null);

    await invalidateEntraDirectConnectionOnRebind({
      tenant: 'tenant-1',
      previousProfileId: 'profile-a',
      nextProfileId: 'profile-b',
    });

    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(updateEntraConnectionValidationMock).not.toHaveBeenCalled();
  });

  it('leaves a CIPP connection untouched', async () => {
    getActiveEntraPartnerConnectionMock.mockResolvedValue({ connection_type: 'cipp', is_active: true });

    await invalidateEntraDirectConnectionOnRebind({
      tenant: 'tenant-1',
      previousProfileId: 'profile-a',
      nextProfileId: 'profile-b',
    });

    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(updateEntraConnectionValidationMock).not.toHaveBeenCalled();
  });
});
