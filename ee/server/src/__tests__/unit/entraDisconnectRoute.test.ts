import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireEntraUiFlagEnabledMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const disconnectActiveEntraConnectionMock = vi.fn();

vi.mock('@ee/app/api/integrations/entra/_guards', () => ({
  requireEntraUiFlagEnabled: requireEntraUiFlagEnabledMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/tokenStore', () => ({
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  clearEntraCippCredentials: clearEntraCippCredentialsMock,
}));

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  disconnectActiveEntraConnection: disconnectActiveEntraConnectionMock,
}));

describe('disconnect Entra route', () => {
  beforeEach(() => {
    vi.resetModules();
    requireEntraUiFlagEnabledMock.mockReset();
    clearEntraDirectTokenSetMock.mockReset();
    clearEntraCippCredentialsMock.mockReset();
    disconnectActiveEntraConnectionMock.mockReset();
  });

  it('T040: clears provider secrets and marks active connection disconnected', async () => {
    requireEntraUiFlagEnabledMock.mockResolvedValue({
      tenantId: 'tenant-40',
      userId: 'user-40',
    });
    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);
    disconnectActiveEntraConnectionMock.mockResolvedValue(undefined);

    const { POST } = await import('@ee/app/api/integrations/entra/disconnect/route');
    const response = await POST();
    const payload = await response.json();

    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-40');
    expect(clearEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-40');
    expect(disconnectActiveEntraConnectionMock).toHaveBeenCalledWith({
      tenant: 'tenant-40',
      userId: 'user-40',
    });

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      data: { status: 'disconnected' },
    });
  });
});
