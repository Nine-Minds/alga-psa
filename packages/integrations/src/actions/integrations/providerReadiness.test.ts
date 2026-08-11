import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const resolveMicrosoftConsumerProfileConfigMock = vi.fn();
const getMicrosoftPlatformCredentialAvailabilityMock = vi.fn();
const isSelfHostLicensingMock = vi.fn();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
  }),
}));

vi.mock('../../lib/microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: (...args: unknown[]) => resolveMicrosoftConsumerProfileConfigMock(...args),
  resolveMicrosoftConsumerProfileConfigReadOnly: (...args: unknown[]) => resolveMicrosoftConsumerProfileConfigMock(...args),
  getMicrosoftPlatformCredentialAvailability: (...args: unknown[]) => getMicrosoftPlatformCredentialAvailabilityMock(...args),
}));

vi.mock('@alga-psa/licensing', () => ({
  isSelfHostLicensing: (...args: unknown[]) => isSelfHostLicensingMock(...args),
}));

import {
  getGoogleProviderReadiness,
  getMicrosoftEmailSetupReadiness,
  getMicrosoftProfileReadiness,
  getMicrosoftProviderReadiness,
} from './providerReadiness';

describe('provider readiness helpers', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    getTenantSecretMock.mockClear();
    resolveMicrosoftConsumerProfileConfigMock.mockReset();
    getMicrosoftPlatformCredentialAvailabilityMock.mockReset();
    isSelfHostLicensingMock.mockReset().mockResolvedValue(false);
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({
      ready: false,
      clientIdConfigured: false,
      clientSecretConfigured: false,
      tenantIdConfigured: false,
    });
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

  it('T019/T020: Microsoft profile readiness also requires tenant id, active state, and referenced secret presence', async () => {
    tenantSecrets.set('tenant-1:microsoft_profile_profile-1_client_secret', 'profile-secret');

    await expect(getMicrosoftProfileReadiness('tenant-1', {
      clientId: 'profile-client-id',
      tenantId: 'profile-tenant-id',
      clientSecretRef: 'microsoft_profile_profile-1_client_secret',
      isArchived: false,
    })).resolves.toEqual({
      ready: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      tenantIdConfigured: true,
      active: true,
    });

    await expect(getMicrosoftProfileReadiness('tenant-1', {
      clientId: 'profile-client-id',
      tenantId: '',
      clientSecretRef: 'microsoft_profile_profile-1_client_secret',
      isArchived: false,
    })).resolves.toEqual({
      ready: false,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      tenantIdConfigured: false,
      active: true,
    });
  });

  it('offers platform setup without treating application secrets as organization approval', async () => {
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValueOnce({
      status: 'not_configured', tenantId: 'tenant-1', consumerType: 'email',
      message: 'Email Microsoft profile binding is not configured',
    }).mockResolvedValueOnce({
      status: 'ready', tenantId: 'tenant-1', consumerType: 'email',
      clientId: 'platform-client-id', clientSecret: 'platform-client-secret',
      microsoftTenantId: 'common', credentialSource: 'app',
    });
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({
      ready: true, clientIdConfigured: true, clientSecretConfigured: true, tenantIdConfigured: false,
    });

    await expect(getMicrosoftEmailSetupReadiness('tenant-1')).resolves.toEqual({
      state: 'not_configured', source: null, hosted: true, platformOffered: true,
      automatedCreationAvailable: false,
      profileId: undefined, message: 'Email Microsoft profile binding is not configured',
    });
  });

  it('recognizes an approved profile created from the platform app', async () => {
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValueOnce({
      status: 'ready', tenantId: 'tenant-1', consumerType: 'email',
      profileId: 'profile-platform', clientId: 'platform-client-id',
      clientSecret: 'profile-secret', microsoftTenantId: 'microsoft-directory-id',
      credentialSource: 'binding',
    }).mockResolvedValueOnce({
      status: 'ready', tenantId: 'tenant-1', consumerType: 'email',
      clientId: 'platform-client-id', clientSecret: 'platform-client-secret',
      microsoftTenantId: 'common', credentialSource: 'app',
    });
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({ ready: true });

    await expect(getMicrosoftEmailSetupReadiness('tenant-1')).resolves.toMatchObject({
      state: 'ready', source: 'platform', profileId: 'profile-platform', platformOffered: true,
    });
  });

  it('keeps an explicitly selected incomplete tenant profile authoritative over platform credentials', async () => {
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValue({
      status: 'invalid_profile', tenantId: 'tenant-1', consumerType: 'email', profileId: 'profile-1',
      message: 'Selected Email Microsoft profile is missing required credentials',
    });
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({
      ready: true, clientIdConfigured: true, clientSecretConfigured: true, tenantIdConfigured: true,
    });

    await expect(getMicrosoftEmailSetupReadiness('tenant-1')).resolves.toMatchObject({
      state: 'not_configured', source: 'tenant_app', platformOffered: true, profileId: 'profile-1',
    });
  });

  it('reports partial platform configuration without exposing credential values', async () => {
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValue({
      status: 'not_configured', tenantId: 'tenant-1', consumerType: 'email',
      message: 'Email Microsoft profile binding is not configured',
    });
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({
      ready: false, clientIdConfigured: true, clientSecretConfigured: false, tenantIdConfigured: false,
    });

    const capability = await getMicrosoftEmailSetupReadiness('tenant-1');
    expect(capability).toEqual({
      state: 'not_configured', source: null, hosted: true, platformOffered: false,
      automatedCreationAvailable: false,
      profileId: undefined, message: 'Email Microsoft profile binding is not configured',
    });
    expect(capability).not.toHaveProperty('clientId');
    expect(capability).not.toHaveProperty('clientSecret');
  });

  it('reports pending Microsoft 365 administrator approval explicitly', async () => {
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValue({
      status: 'pending_admin_consent',
      tenantId: 'tenant-1',
      consumerType: 'email',
      profileId: 'profile-pending',
      credentialSource: 'binding',
    });

    await expect(getMicrosoftEmailSetupReadiness('tenant-1')).resolves.toMatchObject({
      state: 'pending_admin_consent',
      source: 'tenant_app',
      profileId: 'profile-pending',
    });
  });

  it('never offers the AlgaPSA app on a self-hosted deployment', async () => {
    isSelfHostLicensingMock.mockResolvedValue(true);
    resolveMicrosoftConsumerProfileConfigMock.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
    });
    getMicrosoftPlatformCredentialAvailabilityMock.mockResolvedValue({ ready: true });

    await expect(getMicrosoftEmailSetupReadiness('tenant-1')).resolves.toMatchObject({
      hosted: false,
      platformOffered: false,
      state: 'not_configured',
    });
    expect(resolveMicrosoftConsumerProfileConfigMock).toHaveBeenCalledWith(
      'tenant-1',
      'email',
      { credentialPreference: 'tenant' },
    );
  });
});
