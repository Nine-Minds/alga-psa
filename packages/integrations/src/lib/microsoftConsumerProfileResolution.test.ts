import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type MicrosoftProfileRow = {
    tenant: string;
    profile_id: string;
    display_name: string;
    display_name_normalized: string;
    client_id: string;
    tenant_id: string;
    client_secret_ref: string;
    is_default: boolean;
    is_archived: boolean;
    archived_at: string | Date | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  };

  type MicrosoftConsumerBindingRow = {
    tenant: string;
    consumer_type: 'msp_sso' | 'email' | 'calendar' | 'teams';
    profile_id: string;
    created_by: string | null;
    updated_by: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  };

  type LegacyUsageRow = {
    tenant: string;
    provider_type?: string;
    is_active?: boolean;
  };

  const state = {
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as MicrosoftProfileRow[],
    microsoftConsumerBindings: [] as MicrosoftConsumerBindingRow[],
    emailProviders: [] as LegacyUsageRow[],
    calendarProviders: [] as LegacyUsageRow[],
    mspSsoLoginDomains: [] as LegacyUsageRow[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];

    const getRows = () => {
      if (table === 'microsoft_profiles') return state.microsoftProfiles;
      if (table === 'microsoft_profile_consumer_bindings') return state.microsoftConsumerBindings;
      if (table === 'email_providers') return state.emailProviders;
      if (table === 'calendar_providers') return state.calendarProviders;
      if (table === 'msp_sso_tenant_login_domains') return state.mspSsoLoginDomains;
      return [] as Array<Record<string, unknown>>;
    };

    const filteredRows = () => getRows().filter((row) => filters.every((filter) => matchesWhere(row, filter)));

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      async first() {
        const row = filteredRows()[0];
        return row ? clone(row) : undefined;
      },
      async select(..._args: unknown[]) {
        return filteredRows().map((row) => clone(row));
      },
      async insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
        const rows = Array.isArray(values) ? values : [values];

        if (table === 'microsoft_profiles') {
          rows.forEach((row) => state.microsoftProfiles.push(clone(row) as MicrosoftProfileRow));
        }
        if (table === 'microsoft_profile_consumer_bindings') {
          rows.forEach((row) => state.microsoftConsumerBindings.push(clone(row) as MicrosoftConsumerBindingRow));
        }

        return rows.length;
      },
    };
  };

  const dbMock: any = ((table: string) => createQuery(table)) as any;

  return {
    state,
    getTenantSecretMock: vi.fn(async (tenant: string, key: string) => state.tenantSecrets.get(`${tenant}:${key}`) || null),
    getAppSecretMock: vi.fn(async (key: string) => state.appSecrets.get(key) || null),
    setTenantSecretMock: vi.fn(async (tenant: string, key: string, value: string | null) => {
      if (value === null) {
        state.tenantSecrets.delete(`${tenant}:${key}`);
        return;
      }
      state.tenantSecrets.set(`${tenant}:${key}`, value);
    }),
    getAdminConnectionMock: vi.fn(async () => dbMock),
  };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecretMock,
    getAppSecret: hoisted.getAppSecretMock,
    setTenantSecret: hoisted.setTenantSecretMock,
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: hoisted.getAdminConnectionMock,
}));

import { resolveMicrosoftConsumerProfileConfig } from './microsoftConsumerProfileResolution';

describe('resolveMicrosoftConsumerProfileConfig', () => {
  beforeEach(() => {
    hoisted.state.tenantSecrets.clear();
    hoisted.state.appSecrets.clear();
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.microsoftConsumerBindings.length = 0;
    hoisted.state.emailProviders.length = 0;
    hoisted.state.calendarProviders.length = 0;
    hoisted.state.mspSsoLoginDomains.length = 0;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
  });

  it('T323/T324: resolves email credentials from the explicitly bound Microsoft profile instead of broad env fallbacks', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'global-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'global-client-secret';
    process.env.MICROSOFT_TENANT_ID = 'global-tenant-id';

    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'profile-email',
      display_name: 'Email Profile',
      display_name_normalized: 'email profile',
      client_id: 'bound-client-id',
      tenant_id: 'bound-tenant-id',
      client_secret_ref: 'bound-secret-ref',
      is_default: true,
      is_archived: false,
      archived_at: null,
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-1',
      consumer_type: 'email',
      profile_id: 'profile-email',
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    hoisted.state.tenantSecrets.set('tenant-1:bound-secret-ref', 'bound-secret');

    const result = await resolveMicrosoftConsumerProfileConfig('tenant-1', 'email');

    expect(result).toEqual({
      status: 'ready',
      tenantId: 'tenant-1',
      consumerType: 'email',
      profileId: 'profile-email',
      clientId: 'bound-client-id',
      clientSecret: 'bound-secret',
      microsoftTenantId: 'bound-tenant-id',
      credentialSource: 'binding',
    });
    expect(result.clientId).not.toBe(process.env.MICROSOFT_CLIENT_ID);
    expect(result.clientSecret).not.toBe(process.env.MICROSOFT_CLIENT_SECRET);
    expect(result.microsoftTenantId).not.toBe(process.env.MICROSOFT_TENANT_ID);
  });

  it('T401: falls back to hosted app-level Microsoft email credentials when no Email binding exists', async () => {
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_ID', 'hosted-client-id');
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_SECRET', 'hosted-client-secret');
    hoisted.state.appSecrets.set('MICROSOFT_TENANT_ID', 'hosted-tenant-id');

    const result = await resolveMicrosoftConsumerProfileConfig('tenant-hosted', 'email');

    expect(result).toEqual({
      status: 'ready',
      tenantId: 'tenant-hosted',
      consumerType: 'email',
      clientId: 'hosted-client-id',
      clientSecret: 'hosted-client-secret',
      microsoftTenantId: 'hosted-tenant-id',
      credentialSource: 'app',
    });
  });

  it('T402: uses hosted Microsoft email env credentials when app secrets are unavailable', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'env-hosted-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'env-hosted-client-secret';
    process.env.MICROSOFT_TENANT_ID = 'env-hosted-tenant-id';

    const result = await resolveMicrosoftConsumerProfileConfig('tenant-env-hosted', 'email');

    expect(result).toEqual({
      status: 'ready',
      tenantId: 'tenant-env-hosted',
      consumerType: 'email',
      clientId: 'env-hosted-client-id',
      clientSecret: 'env-hosted-client-secret',
      microsoftTenantId: 'env-hosted-tenant-id',
      credentialSource: 'app',
    });
  });

  it('T403: does not implicitly bind Email to an unrelated single Microsoft profile before hosted fallback', async () => {
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_ID', 'hosted-client-id');
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_SECRET', 'hosted-client-secret');
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-with-sso-profile',
      profile_id: 'profile-sso-only',
      display_name: 'SSO Profile',
      display_name_normalized: 'sso profile',
      client_id: 'sso-client-id',
      tenant_id: 'sso-tenant-id',
      client_secret_ref: 'sso-secret-ref',
      is_default: true,
      is_archived: false,
      archived_at: null,
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    hoisted.state.tenantSecrets.set('tenant-with-sso-profile:sso-secret-ref', 'sso-secret');
    hoisted.state.emailProviders.push({
      tenant: 'tenant-with-sso-profile',
      provider_type: 'microsoft',
    });

    await expect(resolveMicrosoftConsumerProfileConfig('tenant-with-sso-profile', 'email')).resolves.toEqual({
      status: 'ready',
      tenantId: 'tenant-with-sso-profile',
      consumerType: 'email',
      clientId: 'hosted-client-id',
      clientSecret: 'hosted-client-secret',
      microsoftTenantId: 'common',
      credentialSource: 'app',
    });
    expect(hoisted.state.microsoftConsumerBindings).toHaveLength(0);
  });

  it('T404: does not fall back to hosted credentials when an explicit Email binding is invalid', async () => {
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_ID', 'hosted-client-id');
    hoisted.state.appSecrets.set('MICROSOFT_CLIENT_SECRET', 'hosted-client-secret');
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-invalid-binding',
      consumer_type: 'email',
      profile_id: 'missing-profile',
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await expect(resolveMicrosoftConsumerProfileConfig('tenant-invalid-binding', 'email')).resolves.toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-invalid-binding',
      consumerType: 'email',
      profileId: 'missing-profile',
      message: 'Selected Email Microsoft profile is missing or archived',
    });
  });

  it('T325/T326: materializes the calendar binding only from concrete legacy calendar usage and otherwise fails closed', async () => {
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_client_id', 'legacy-client');
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_client_secret', 'legacy-secret');
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_tenant_id', 'legacy-tenant');
    hoisted.state.calendarProviders.push({
      tenant: 'tenant-1',
      provider_type: 'microsoft',
    });

    const ready = await resolveMicrosoftConsumerProfileConfig('tenant-1', 'calendar');

    expect(ready.status).toBe('ready');
    expect(ready.consumerType).toBe('calendar');
    expect(ready.clientId).toBe('legacy-client');
    expect(ready.clientSecret).toBe('legacy-secret');
    expect(ready.microsoftTenantId).toBe('legacy-tenant');
    expect(hoisted.state.microsoftProfiles).toHaveLength(1);
    expect(hoisted.state.microsoftConsumerBindings).toEqual([
      expect.objectContaining({
        tenant: 'tenant-1',
        consumer_type: 'calendar',
        profile_id: hoisted.state.microsoftProfiles[0].profile_id,
      }),
    ]);

    const missing = await resolveMicrosoftConsumerProfileConfig('tenant-2', 'calendar');
    expect(missing).toEqual({
      status: 'not_configured',
      tenantId: 'tenant-2',
      consumerType: 'calendar',
      message: 'Calendar Microsoft profile binding is not configured',
    });
  });

  it('T321/T322/T349/T350: resolves MSP SSO from the explicit binding path and does not revive default-profile routing once no active domain binding exists', async () => {
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_client_id', 'legacy-client');
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_client_secret', 'legacy-secret');
    hoisted.state.tenantSecrets.set('tenant-1:microsoft_tenant_id', 'legacy-tenant');
    hoisted.state.mspSsoLoginDomains.push({
      tenant: 'tenant-1',
      is_active: true,
    });

    const ready = await resolveMicrosoftConsumerProfileConfig('tenant-1', 'msp_sso');

    expect(ready).toEqual({
      status: 'ready',
      tenantId: 'tenant-1',
      consumerType: 'msp_sso',
      profileId: hoisted.state.microsoftProfiles[0].profile_id,
      clientId: 'legacy-client',
      clientSecret: 'legacy-secret',
      microsoftTenantId: 'legacy-tenant',
      credentialSource: 'binding',
    });
    expect(hoisted.state.microsoftConsumerBindings).toEqual([
      expect.objectContaining({
        tenant: 'tenant-1',
        consumer_type: 'msp_sso',
        profile_id: hoisted.state.microsoftProfiles[0].profile_id,
      }),
    ]);

    hoisted.state.mspSsoLoginDomains.length = 0;
    hoisted.state.microsoftConsumerBindings.length = 0;

    const missing = await resolveMicrosoftConsumerProfileConfig('tenant-1', 'msp_sso');
    expect(missing).toEqual({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'msp_sso',
      message: 'MSP SSO Microsoft profile binding is not configured',
    });
  });

  it('T373/T374: returns invalid_profile when the bound profile is archived or missing required credentials', async () => {
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-3',
      profile_id: 'archived-profile',
      display_name: 'Archived Profile',
      display_name_normalized: 'archived profile',
      client_id: 'archived-client-id',
      tenant_id: 'archived-tenant-id',
      client_secret_ref: 'archived-secret-ref',
      is_default: false,
      is_archived: true,
      archived_at: new Date().toISOString(),
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-3',
      consumer_type: 'email',
      profile_id: 'archived-profile',
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await expect(resolveMicrosoftConsumerProfileConfig('tenant-3', 'email')).resolves.toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-3',
      consumerType: 'email',
      profileId: 'archived-profile',
      message: 'Selected Email Microsoft profile is missing or archived',
    });
  });
});
