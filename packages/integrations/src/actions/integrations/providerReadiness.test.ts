import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecretMock(...args),
  }),
}));

import { getGoogleProviderReadiness, getMicrosoftProviderReadiness } from './providerReadiness';

describe('provider readiness helpers', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    getTenantSecretMock.mockClear();
  });

  it('T016: Microsoft readiness requires both microsoft_client_id and microsoft_client_secret', async () => {
    tenantSecrets.set('tenant-1:microsoft_client_id', 'client-id');

    await expect(getMicrosoftProviderReadiness('tenant-1')).resolves.toEqual({
      ready: false,
      clientIdConfigured: true,
      clientSecretConfigured: false,
    });

    tenantSecrets.set('tenant-1:microsoft_client_secret', 'client-secret');

    await expect(getMicrosoftProviderReadiness('tenant-1')).resolves.toEqual({
      ready: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
    });
  });

  it('T017/T023: Google readiness requires only google_client_id and google_client_secret', async () => {
    tenantSecrets.set('tenant-1:google_client_id', 'google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'google-secret');
    // Intentionally omit all Gmail PubSub keys; readiness must still be true for MSP SSO purposes.

    await expect(getGoogleProviderReadiness('tenant-1')).resolves.toEqual({
      ready: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
    });

    tenantSecrets.delete('tenant-1:google_client_secret');

    await expect(getGoogleProviderReadiness('tenant-1')).resolves.toEqual({
      ready: false,
      clientIdConfigured: true,
      clientSecretConfigured: false,
    });
  });
});
