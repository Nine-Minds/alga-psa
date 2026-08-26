import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveBoundMock = vi.fn();
vi.mock('@alga-psa/integrations/lib/microsoftConsumerProfileResolution', () => ({ resolveMicrosoftConsumerProfileConfigBound: resolveBoundMock }));

describe('resolveMicrosoftCredentialsForTenant', () => {
  const priorClientId = process.env.MICROSOFT_CLIENT_ID;
  const priorSecret = process.env.MICROSOFT_CLIENT_SECRET;
  beforeEach(() => { vi.resetModules(); resolveBoundMock.mockReset(); });
  afterEach(() => {
    if (priorClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID; else process.env.MICROSOFT_CLIENT_ID = priorClientId;
    if (priorSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET; else process.env.MICROSOFT_CLIENT_SECRET = priorSecret;
  });
  it('uses only the explicit entra binding, ignoring environment credentials', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'vendor-app'; process.env.MICROSOFT_CLIENT_SECRET = 'vendor-secret';
    resolveBoundMock.mockResolvedValue({ status: 'ready', profileId: 'profile-1', profileDisplayName: 'MSP Entra App', clientId: 'customer-app', clientSecret: 'customer-secret', microsoftTenantId: 'partner-tenant' });
    const { resolveMicrosoftCredentialsForTenant } = await import('@ee/lib/integrations/entra/auth/microsoftCredentialResolver');
    await expect(resolveMicrosoftCredentialsForTenant('tenant-42')).resolves.toEqual({ clientId: 'customer-app', clientSecret: 'customer-secret', tenantId: 'partner-tenant', source: 'profile', profileId: 'profile-1', profileDisplayName: 'MSP Entra App' });
    expect(resolveBoundMock).toHaveBeenCalledWith('tenant-42', 'entra');
  });
  it.each([{ status: 'not_configured' }, { status: 'invalid_profile', profileId: 'gone' }, { status: 'ready', profileId: 'profile-1', clientId: ' ', clientSecret: 'secret' }, { status: 'ready', profileId: 'profile-1', clientId: 'id', clientSecret: ' ' }])('returns null for unusable bindings', async (resolution) => {
    resolveBoundMock.mockResolvedValue(resolution);
    const { resolveMicrosoftCredentialsForTenant } = await import('@ee/lib/integrations/entra/auth/microsoftCredentialResolver');
    await expect(resolveMicrosoftCredentialsForTenant('tenant-42')).resolves.toBeNull();
  });
});
