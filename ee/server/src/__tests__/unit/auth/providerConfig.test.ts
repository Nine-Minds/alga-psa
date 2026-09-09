import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasTenantProviderCredentials = vi.fn();
const hasAppFallbackProviderCredentials = vi.fn();

vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  hasTenantProviderCredentials,
  hasAppFallbackProviderCredentials,
}));

import { getSsoProviderOptions } from '@ee/lib/auth/providerConfig';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function optionFor(options: Awaited<ReturnType<typeof getSsoProviderOptions>>, id: string) {
  const option = options.find((entry) => entry.id === id);
  expect(option).toBeDefined();
  return option!;
}

describe('getSsoProviderOptions', () => {
  beforeEach(() => {
    hasTenantProviderCredentials.mockReset();
    hasAppFallbackProviderCredentials.mockReset();
  });

  it('reports azure-ad as configured from the tenant provider profile without app secrets', async () => {
    hasTenantProviderCredentials.mockImplementation(async (_tenant: string, provider: string) =>
      provider === 'azure-ad'
    );
    hasAppFallbackProviderCredentials.mockResolvedValue(false);

    const options = await getSsoProviderOptions(TENANT_ID);

    expect(optionFor(options, 'azure-ad').configured).toBe(true);
    expect(optionFor(options, 'google').configured).toBe(false);
    expect(hasTenantProviderCredentials).toHaveBeenCalledWith(TENANT_ID, 'azure-ad');
  });

  it('reports providers as not configured when neither source has credentials', async () => {
    hasTenantProviderCredentials.mockResolvedValue(false);
    hasAppFallbackProviderCredentials.mockResolvedValue(false);

    const options = await getSsoProviderOptions(TENANT_ID);

    expect(optionFor(options, 'azure-ad').configured).toBe(false);
    expect(optionFor(options, 'google').configured).toBe(false);
  });

  it('falls back to app-level credentials when the tenant has none', async () => {
    hasTenantProviderCredentials.mockResolvedValue(false);
    hasAppFallbackProviderCredentials.mockResolvedValue(true);

    const options = await getSsoProviderOptions(TENANT_ID);

    expect(optionFor(options, 'azure-ad').configured).toBe(true);
    expect(optionFor(options, 'google').configured).toBe(true);
  });

  it('checks only app-level credentials when no tenant is supplied', async () => {
    hasTenantProviderCredentials.mockResolvedValue(true);
    hasAppFallbackProviderCredentials.mockResolvedValue(false);

    const options = await getSsoProviderOptions();

    expect(optionFor(options, 'azure-ad').configured).toBe(false);
    expect(hasTenantProviderCredentials).not.toHaveBeenCalled();
  });

  it('treats a failing tenant lookup as unconfigured and still honours the app fallback', async () => {
    hasTenantProviderCredentials.mockRejectedValue(new Error('database unavailable'));
    hasAppFallbackProviderCredentials.mockResolvedValue(true);

    const options = await getSsoProviderOptions(TENANT_ID);

    expect(optionFor(options, 'azure-ad').configured).toBe(true);
  });
});
