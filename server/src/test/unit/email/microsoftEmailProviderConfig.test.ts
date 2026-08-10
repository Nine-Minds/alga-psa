import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as Record<string, unknown>[],
    bindings: [] as Record<string, unknown>[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matches = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];
    const filteredRows = () =>
      (table.startsWith('microsoft_profile_consumer_bindings')
        ? state.bindings
        : table === 'microsoft_profiles'
          ? state.microsoftProfiles
          : []
      ).filter((row) => filters.every((filter) => matches(row, filter)));

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      andWhere(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      tenantJoin() {
        return this;
      },
      async first() {
        const row = filteredRows()[0];
        return row ? clone(row) : undefined;
      },
    };
  };

  const dbMock: any = ((table: string) => createQuery(table)) as any;

  return {
    state,
    getAdminConnection: vi.fn(async () => dbMock),
    getAppSecret: vi.fn(async (key: string) => state.appSecrets.get(key) || null),
    getTenantSecret: vi.fn(async (tenant: string, key: string) =>
      state.tenantSecrets.get(`${tenant}:${key}`) || null
    ),
  };
});

vi.mock('@alga-psa/db', () => ({
  getAdminConnection: hoisted.getAdminConnection,
  destroyAdminConnection: vi.fn(),
  refreshAdminConnection: vi.fn(),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: hoisted.getAppSecret,
    getTenantSecret: hoisted.getTenantSecret,
  }),
}));

import {
  buildMicrosoftEmailProviderConfig,
  selectMicrosoftEmailRuntimeCredentials,
  type MicrosoftEmailRuntimeCredentials,
} from '@alga-psa/shared/services/email/microsoftEmailProviderConfig';

function credential(
  clientId: string,
  clientSecret: string,
  source: MicrosoftEmailRuntimeCredentials['source']
): MicrosoftEmailRuntimeCredentials {
  return { clientId, clientSecret, tenantId: 'common', source };
}

describe('Microsoft email runtime credential selection', () => {
  it('uses the bound profile and its rotated secret when the issuing client id matches', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'premise-app',
      profileCredentials: credential('premise-app', 'rotated-secret', 'profile'),
      fallbackCredentials: credential('premise-app', 'old-secret', 'vendor'),
    });

    expect(selected).toMatchObject({
      clientId: 'premise-app',
      clientSecret: 'rotated-secret',
      source: 'profile',
    });
  });

  it('keeps using stored issuing-app credentials after a profile swap', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'hosted-app',
      profileCredentials: credential('tenant-app', 'tenant-secret', 'profile'),
      fallbackCredentials: credential('hosted-app', 'hosted-secret', 'vendor'),
    });

    expect(selected).toMatchObject({
      clientId: 'hosted-app',
      clientSecret: 'hosted-secret',
      source: 'vendor',
    });
  });

  it('does not cross clients when the stored issuing credentials are unavailable', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'old-app',
      profileCredentials: credential('new-app', 'new-secret', 'profile'),
      fallbackCredentials: null,
    });

    expect(selected).toBeNull();
  });

  it('does not use environment credentials from a different app than the issuer', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'premise-app',
      profileCredentials: null,
      fallbackCredentials: credential('hosted-app', 'hosted-secret', 'environment'),
    });

    expect(selected).toBeNull();
  });
});

describe('buildMicrosoftEmailProviderConfig provider-pinned issuer resolution', () => {
  beforeEach(() => {
    hoisted.state.tenantSecrets.clear();
    hoisted.state.appSecrets.clear();
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.bindings.length = 0;
  });

  it('T004/T014: resolves the pinned profile secret after the Email binding changes', async () => {
    // Provider pinned to profile p-pinned (issuing app), current binding now
    // points at a different app; the pinned profile holds a rotated secret.
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'p-pinned',
      client_id: 'provider-app',
      client_secret_ref: 'ref-pinned',
      tenant_id: 'tenant-dir',
      capabilities: JSON.stringify(['email']),
      is_archived: false,
    });
    hoisted.state.tenantSecrets.set('tenant-1:ref-pinned', 'rotated-secret');

    const config = await buildMicrosoftEmailProviderConfig({
      id: 'provider-1',
      tenant: 'tenant-1',
      name: 'Mailbox',
      provider_type: 'microsoft',
      mailbox: 'support@client.com',
      folder_to_monitor: 'Inbox',
      active: true,
      provider_config: {
        client_id: 'provider-app',
        client_secret: 'stale-vendor-secret',
        microsoft_profile_id: 'p-pinned',
        client_secret_ref: 'ref-pinned',
        tenant_id: 'tenant-dir',
      },
    } as any);

    expect(config.provider_config.resolved_client_id).toBe('provider-app');
    expect(config.provider_config.resolved_client_secret).toBe('rotated-secret');
    expect(config.provider_config.resolved_profile_id).toBe('p-pinned');
    expect(config.provider_config.resolved_client_secret_ref).toBe('ref-pinned');
    expect(config.provider_config.resolved_credential_source).toBe('profile');
  });

  it('T009/T013: legacy rows without a pinned profile fall back to stored vendor credentials', async () => {
    const config = await buildMicrosoftEmailProviderConfig({
      id: 'provider-1',
      tenant: 'tenant-1',
      name: 'Mailbox',
      provider_type: 'microsoft',
      mailbox: 'support@client.com',
      folder_to_monitor: 'Inbox',
      active: true,
      provider_config: {
        client_id: 'legacy-app',
        client_secret: 'legacy-vendor-secret',
        tenant_id: 'common',
      },
    } as any);

    expect(config.provider_config.resolved_client_id).toBe('legacy-app');
    expect(config.provider_config.resolved_client_secret).toBe('legacy-vendor-secret');
    expect(config.provider_config.resolved_credential_source).toBe('vendor');
  });

  it('fails closed when the pinned profile no longer exists instead of falling back to the Email binding', async () => {
    // The provider pinned its issuer to profile p-gone, which has been deleted.
    // A fallback Email binding points at a different app; the resolver must
    // hard-fail rather than silently re-issuing tokens from another app.
    hoisted.state.tenantSecrets.set('tenant-1:ref-gone', 'secret-for-gone-profile');
    hoisted.state.bindings.push({
      tenant: 'tenant-1',
      consumer_type: 'email',
      profile_id: 'p-bound',
    });
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'p-bound',
      client_id: 'bound-app',
      client_secret_ref: 'ref-bound',
      tenant_id: 'tenant-dir',
      capabilities: JSON.stringify(['email']),
      is_archived: false,
    });
    hoisted.state.tenantSecrets.set('tenant-1:ref-bound', 'bound-secret');

    await expect(
      buildMicrosoftEmailProviderConfig({
        id: 'provider-1',
        tenant: 'tenant-1',
        name: 'Mailbox',
        provider_type: 'microsoft',
        mailbox: 'support@client.com',
        folder_to_monitor: 'Inbox',
        active: true,
        provider_config: {
          client_id: 'pinned-app',
          client_secret: 'stale-vendor-secret',
          microsoft_profile_id: 'p-gone',
          client_secret_ref: 'ref-gone',
          tenant_id: 'tenant-dir',
        },
      } as any)
    ).rejects.toThrow(/pinned to profile p-gone/);
    await expect(
      buildMicrosoftEmailProviderConfig({
        id: 'provider-1',
        tenant: 'tenant-1',
        name: 'Mailbox',
        provider_type: 'microsoft',
        mailbox: 'support@client.com',
        folder_to_monitor: 'Inbox',
        active: true,
        provider_config: {
          client_id: 'pinned-app',
          client_secret: 'stale-vendor-secret',
          microsoft_profile_id: 'p-gone',
          client_secret_ref: 'ref-gone',
          tenant_id: 'tenant-dir',
        },
      } as any)
    ).rejects.toThrow(/ms_email_provider_not_found/);
  });

  it('fails closed when the pinned profile resolves but disagrees with the persisted issuing client', async () => {
    // The pin references an existing profile whose app differs from the
    // persisted client_id; that is a corrupted pin, not a fallback signal.
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'p-wrong',
      client_id: 'different-app',
      client_secret_ref: 'ref-wrong',
      tenant_id: 'tenant-dir',
      capabilities: JSON.stringify(['email']),
      is_archived: false,
    });
    hoisted.state.tenantSecrets.set('tenant-1:ref-wrong', 'wrong-secret');

    await expect(
      buildMicrosoftEmailProviderConfig({
        id: 'provider-1',
        tenant: 'tenant-1',
        name: 'Mailbox',
        provider_type: 'microsoft',
        mailbox: 'support@client.com',
        folder_to_monitor: 'Inbox',
        active: true,
        provider_config: {
          client_id: 'pinned-app',
          client_secret: 'stale-vendor-secret',
          microsoft_profile_id: 'p-wrong',
          client_secret_ref: 'ref-wrong',
          tenant_id: 'tenant-dir',
        },
      } as any)
    ).rejects.toThrow(/ms_email_client_mismatch_reconnect_required/);
  });

  it('never resolves the tenant Teams app as an email credential source', async () => {
    // Even if a provider row is somehow pinned to a profile carrying the
    // well-known Teams app client id (with email capability misconfigured on),
    // the resolver must fail closed instead of handing the Teams app's
    // credentials to a mailbox.
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'p-teams',
      client_id: '02c1ecbc-10db-4439-b002-1187acf7b268',
      client_secret_ref: 'ref-teams',
      tenant_id: 'tenant-dir',
      capabilities: JSON.stringify(['email', 'teams']),
      is_archived: false,
    });
    hoisted.state.tenantSecrets.set('tenant-1:ref-teams', 'teams-secret');

    await expect(
      buildMicrosoftEmailProviderConfig({
        id: 'provider-1',
        tenant: 'tenant-1',
        name: 'Mailbox',
        provider_type: 'microsoft',
        mailbox: 'support@client.com',
        folder_to_monitor: 'Inbox',
        active: true,
        provider_config: {
          client_id: '02c1ecbc-10db-4439-b002-1187acf7b268',
          client_secret: 'teams-secret',
          microsoft_profile_id: 'p-teams',
          client_secret_ref: 'ref-teams',
          tenant_id: 'tenant-dir',
        },
      } as any)
    ).rejects.toThrow(/ms_email_provider_not_found/);
  });
});
