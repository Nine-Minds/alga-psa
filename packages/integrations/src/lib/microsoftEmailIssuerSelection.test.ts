import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const state = {
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as Row[],
    microsoftConsumerBindings: [] as Row[],
    emailProviders: [] as Row[],
    microsoftEmailProviderConfigs: [] as Row[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  const rowsFor = (table: string): Row[] => {
    switch (table) {
      case 'microsoft_profiles':
        return state.microsoftProfiles;
      case 'microsoft_profile_consumer_bindings':
        return state.microsoftConsumerBindings;
      case 'email_providers':
        return state.emailProviders;
      case 'microsoft_email_provider_config':
        return state.microsoftEmailProviderConfigs;
      default:
        return [] as Row[];
    }
  };

  const matches = (row: Row, conditions: Row): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Row[] = [];
    const filteredRows = () =>
      rowsFor(table).filter((row) => filters.every((f) => matches(row, f)));

    return {
      where(conditions: Row) {
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
      async insert(values: Row | Row[]) {
        const rows = Array.isArray(values) ? values : [values];
        rows.forEach((row) => rowsFor(table).push(clone(row)));
        return rows.length;
      },
      async update(values: Row) {
        const rows = filteredRows();
        rows.forEach((row) => Object.assign(row, clone(values)));
        return rows.length;
      },
    };
  };

  const dbMock: any = ((table: string) => createQuery(table)) as any;
  (dbMock as any).fn = { now: () => new Date().toISOString() };

  const resolveMicrosoftConsumerProfileConfig = vi.fn();

  return {
    state,
    getTenantSecret: vi.fn(async (tenant: string, key: string) => state.tenantSecrets.get(`${tenant}:${key}`) || null),
    getAppSecret: vi.fn(async (key: string) => state.appSecrets.get(key) || null),
    setTenantSecret: vi.fn(async (tenant: string, key: string, value: string | null) => {
      if (value === null) {
        state.tenantSecrets.delete(`${tenant}:${key}`);
      } else {
        state.tenantSecrets.set(`${tenant}:${key}`, value);
      }
    }),
    getAdminConnection: vi.fn(async () => dbMock),
    resolveMicrosoftConsumerProfileConfig,
  };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecret,
    getAppSecret: hoisted.getAppSecret,
    setTenantSecret: hoisted.setTenantSecret,
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: hoisted.getAdminConnection,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

vi.mock('./microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: (...args: unknown[]) =>
    hoisted.resolveMicrosoftConsumerProfileConfig(...args),
}));

import {
  MICROSOFT_EMAIL_ISSUER_ERRORS,
  MicrosoftEmailIssuerError,
  backfillMicrosoftEmailProviderIssuerMetadata,
  listEligibleMicrosoftEmailIssuers,
  resolveMicrosoftEmailIssuerChoice,
} from './microsoftEmailIssuerSelection';

const profile = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenant: 'tenant-1',
  profile_id: 'profile-1',
  display_name: 'Profile One',
  client_id: 'client-1',
  tenant_id: 'tenant-dir-1',
  client_secret_ref: 'ref-1',
  capabilities: ['email', 'calendar'],
  is_default: true,
  is_archived: false,
  email_admin_consent_required: false,
  email_admin_consent_granted_at: null,
  ...overrides,
});

function seedProfiles(rows: Record<string, unknown>[]): void {
  hoisted.state.microsoftProfiles.push(...rows);
}

function seedProviderConfig(clientId: string | null, profileId: string | null = null): string {
  const providerId = `provider-${hoisted.state.emailProviders.length + 1}`;
  hoisted.state.emailProviders.push({
    id: providerId,
    tenant: 'tenant-1',
    provider_type: 'microsoft',
  });
  hoisted.state.microsoftEmailProviderConfigs.push({
    tenant: 'tenant-1',
    email_provider_id: providerId,
    client_id: clientId,
    microsoft_profile_id: profileId,
    client_secret_ref: null,
    tenant_id: 'common',
  });
  return providerId;
}

describe('listEligibleMicrosoftEmailIssuers', () => {
  beforeEach(() => {
    hoisted.state.tenantSecrets.clear();
    hoisted.state.appSecrets.clear();
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.microsoftConsumerBindings.length = 0;
    hoisted.state.emailProviders.length = 0;
    hoisted.state.microsoftEmailProviderConfigs.length = 0;
    hoisted.resolveMicrosoftConsumerProfileConfig.mockReset();
  });

  it('recommends the managed app when the platform is ready and lists eligible tenant profiles', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      consumerType: 'email',
      credentialSource: 'app',
      clientId: 'managed-client-id',
      clientSecret: 'managed-client-secret',
      microsoftTenantId: 'common',
    });
    seedProfiles([
      profile({ profile_id: 'p-1', display_name: 'Email App', client_id: 'client-1' }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.managed).toMatchObject({
      kind: 'managed',
      clientId: 'managed-client-id',
      recommended: true,
    });
    expect(issuers.recommended).toEqual({ kind: 'managed', clientId: 'managed-client-id' });
    expect(issuers.profiles).toHaveLength(1);
    expect(issuers.profiles[0]).toMatchObject({
      kind: 'profile',
      profileId: 'p-1',
      clientId: 'client-1',
    });
  });

  it('falls back to the tenant Email binding profile as the recommended default when managed is unavailable', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'Platform Microsoft credentials are not configured',
    });
    seedProfiles([profile({ profile_id: 'p-1', display_name: 'Bound Email App', client_id: 'bound-client' })]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-1',
      consumer_type: 'email',
      profile_id: 'p-1',
    });

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.managed).toBeUndefined();
    expect(issuers.recommended).toEqual({
      kind: 'profile',
      profileId: 'p-1',
      clientId: 'bound-client',
    });
  });

  it('lists multiple eligible tenant profiles so the admin can choose one', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'not configured',
    });
    seedProfiles([
      profile({ profile_id: 'p-1', display_name: 'App A', client_id: 'client-a' }),
      profile({ profile_id: 'p-2', display_name: 'App B', client_id: 'client-b', is_default: false }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-a');

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.profiles.map((p) => p.profileId)).toEqual(['p-1', 'p-2']);
  });

  it('never lists a Teams-only app or a pending-consent app for Email', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'not configured',
    });
    seedProfiles([
      profile({ profile_id: 'p-teams', display_name: 'Teams Only', client_id: 'teams-client', capabilities: ['teams'] }),
      profile({
        profile_id: 'p-consent',
        display_name: 'Pending Consent',
        client_id: 'consent-client',
        email_admin_consent_required: true,
        email_admin_consent_granted_at: null,
        is_default: false,
      }),
    ]);

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.profiles).toHaveLength(0);
  });

  it('never lists a profile whose credential secret cannot be resolved', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'not configured',
    });
    // Structurally eligible (active, Email-capable, consented) but the secret
    // behind client_secret_ref is absent — it must not be selectable.
    seedProfiles([
      profile({ profile_id: 'p-nosecret', display_name: 'No Secret', client_id: 'nosecret-client', client_secret_ref: 'ref-nosecret' }),
      profile({ profile_id: 'p-ready', display_name: 'Ready App', client_id: 'ready-client', is_default: false }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.profiles.map((p) => p.profileId)).toEqual(['p-ready']);
  });

  it('never lists or recommends the tenant Teams app even when it carries Email capability', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'not configured',
    });
    // The well-known Teams client id must be excluded regardless of how the
    // profile is labeled.
    seedProfiles([
      profile({
        profile_id: 'p-teams-app',
        display_name: 'Teams App',
        client_id: '02c1ecbc-10db-4439-b002-1187acf7b268',
        capabilities: ['teams', 'email'],
        is_default: true,
      }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-1',
      consumer_type: 'email',
      profile_id: 'p-teams-app',
    });

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.profiles).toHaveLength(0);
    expect(issuers.recommended).toBeNull();
  });

  it('does not recommend a bound profile whose secret cannot be resolved', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'not configured',
    });
    seedProfiles([profile({ profile_id: 'p-bound', display_name: 'Bound No Secret', client_id: 'bound-client' })]);
    hoisted.state.microsoftConsumerBindings.push({
      tenant: 'tenant-1',
      consumer_type: 'email',
      profile_id: 'p-bound',
    });

    const issuers = await listEligibleMicrosoftEmailIssuers('tenant-1');

    expect(issuers.recommended).toBeNull();
    expect(issuers.profiles).toHaveLength(0);
  });
});

describe('resolveMicrosoftEmailIssuerChoice', () => {
  beforeEach(() => {
    hoisted.state.tenantSecrets.clear();
    hoisted.state.appSecrets.clear();
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.microsoftConsumerBindings.length = 0;
    hoisted.state.emailProviders.length = 0;
    hoisted.state.microsoftEmailProviderConfigs.length = 0;
    hoisted.resolveMicrosoftConsumerProfileConfig.mockReset();
  });

  it('resolves a managed selection to the platform app', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      consumerType: 'email',
      credentialSource: 'app',
      clientId: 'managed-client-id',
      clientSecret: 'managed-client-secret',
      microsoftTenantId: 'common',
    });

    const resolution = await resolveMicrosoftEmailIssuerChoice('tenant-1', {
      kind: 'managed',
      clientId: 'managed-client-id',
    });

    expect(resolution).toMatchObject({
      issuerKind: 'managed',
      clientId: 'managed-client-id',
      clientSecret: 'managed-client-secret',
      microsoftTenantId: 'common',
    });
  });

  it('rejects a managed choice when the platform app is not configured', async () => {
    hoisted.resolveMicrosoftConsumerProfileConfig.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      consumerType: 'email',
      message: 'Platform Microsoft credentials are not configured',
    });

    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', { kind: 'managed', clientId: 'managed-client-id' })
    ).rejects.toMatchObject({
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.ISSUER_NOT_READY,
    });
  });

  it('resolves an eligible tenant profile and pins its profile and secret reference', async () => {
    seedProfiles([profile({ profile_id: 'p-1', client_id: 'client-1' })]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');

    const resolution = await resolveMicrosoftEmailIssuerChoice('tenant-1', {
      kind: 'profile',
      profileId: 'p-1',
      clientId: 'client-1',
    });

    expect(resolution).toMatchObject({
      issuerKind: 'profile',
      profileId: 'p-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      clientSecretRef: 'ref-1',
      microsoftTenantId: 'tenant-dir-1',
    });
  });

  it('rejects a Teams-only profile for Email with a stable capability error', async () => {
    seedProfiles([profile({ profile_id: 'p-teams', client_id: 'teams-client', capabilities: ['teams'] })]);

    const promise = resolveMicrosoftEmailIssuerChoice('tenant-1', {
      kind: 'profile',
      profileId: 'p-teams',
      clientId: 'teams-client',
    });
    await expect(promise).rejects.toBeInstanceOf(MicrosoftEmailIssuerError);
    await expect(promise).rejects.toMatchObject({
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.MISSING_EMAIL_CAPABILITY,
    });
  });

  it('rejects the tenant Teams app client id even when the profile claims Email capability', async () => {
    seedProfiles([
      profile({
        profile_id: 'p-teams-app',
        client_id: '02c1ecbc-10db-4439-b002-1187acf7b268',
        capabilities: ['teams', 'email'],
      }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');

    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', {
        kind: 'profile',
        profileId: 'p-teams-app',
        clientId: '02c1ecbc-10db-4439-b002-1187acf7b268',
      })
    ).rejects.toMatchObject({ code: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE });
  });

  it('rejects an archived profile', async () => {
    seedProfiles([profile({ profile_id: 'p-archived', is_archived: true })]);

    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', { kind: 'profile', profileId: 'p-archived', clientId: 'client-1' })
    ).rejects.toMatchObject({ code: MICROSOFT_EMAIL_ISSUER_ERRORS.INACTIVE_PROFILE });
  });

  it('rejects a profile whose tenant consent is still pending', async () => {
    seedProfiles([
      profile({
        profile_id: 'p-consent',
        email_admin_consent_required: true,
        email_admin_consent_granted_at: null,
      }),
    ]);

    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', { kind: 'profile', profileId: 'p-consent', clientId: 'client-1' })
    ).rejects.toMatchObject({ code: MICROSOFT_EMAIL_ISSUER_ERRORS.CONSENT_NOT_READY });
  });

  it('rejects an unknown / cross-tenant profile', async () => {
    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', { kind: 'profile', profileId: 'missing', clientId: 'x' })
    ).rejects.toMatchObject({ code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROFILE_NOT_FOUND });
  });

  it('rejects a malformed choice', async () => {
    await expect(resolveMicrosoftEmailIssuerChoice('tenant-1', null)).rejects.toMatchObject({
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
    });
    await expect(
      resolveMicrosoftEmailIssuerChoice('tenant-1', { kind: 'profile', clientId: '' })
    ).rejects.toMatchObject({ code: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE });
  });
});

describe('backfillMicrosoftEmailProviderIssuerMetadata', () => {
  beforeEach(() => {
    hoisted.state.tenantSecrets.clear();
    hoisted.state.appSecrets.clear();
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.microsoftConsumerBindings.length = 0;
    hoisted.state.emailProviders.length = 0;
    hoisted.state.microsoftEmailProviderConfigs.length = 0;
    hoisted.resolveMicrosoftConsumerProfileConfig.mockReset();
  });

  it('backfills a unique same-client eligible profile and leaves ambiguous rows unchanged', async () => {
    seedProfiles([
      profile({ profile_id: 'p-1', display_name: 'App A', client_id: 'shared-client', is_default: true }),
      profile({ profile_id: 'p-2', display_name: 'App B', client_id: 'shared-client', is_default: false }),
      profile({ profile_id: 'p-3', display_name: 'Unique App', client_id: 'unique-client', is_default: false }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');

    // unique-client: exactly one eligible match -> backfilled.
    const uniqueProviderId = seedProviderConfig('unique-client');
    // shared-client: two eligible matches -> ambiguous, left untouched.
    const ambiguousProviderId = seedProviderConfig('shared-client');
    // no client id -> untouched.
    const noClientProviderId = seedProviderConfig(null);

    const result = await backfillMicrosoftEmailProviderIssuerMetadata('tenant-1');

    expect(result.backfilled).toBe(1);
    expect(result.ambiguous).toBe(1);
    expect(result.unchanged).toBe(1);

    const uniqueConfig = hoisted.state.microsoftEmailProviderConfigs.find(
      (row) => row.email_provider_id === uniqueProviderId
    );
    expect(uniqueConfig).toMatchObject({
      microsoft_profile_id: 'p-3',
      client_secret_ref: 'ref-1',
    });

    const ambiguousConfig = hoisted.state.microsoftEmailProviderConfigs.find(
      (row) => row.email_provider_id === ambiguousProviderId
    );
    expect(ambiguousConfig?.microsoft_profile_id).toBeNull();

    const noClientConfig = hoisted.state.microsoftEmailProviderConfigs.find(
      (row) => row.email_provider_id === noClientProviderId
    );
    expect(noClientConfig?.microsoft_profile_id).toBeNull();
  });

  it('does not touch rows already pinned to a profile', async () => {
    seedProfiles([profile({ profile_id: 'p-1', client_id: 'client-1' })]);
    seedProviderConfig('client-1', 'p-1');

    const result = await backfillMicrosoftEmailProviderIssuerMetadata('tenant-1');

    expect(result.backfilled).toBe(0);
    const config = hoisted.state.microsoftEmailProviderConfigs[0];
    expect(config.microsoft_profile_id).toBe('p-1');
  });

  it('does not backfill a profile whose secret cannot be resolved', async () => {
    seedProfiles([
      profile({ profile_id: 'p-1', client_id: 'unique-client', client_secret_ref: 'ref-nosecret' }),
    ]);
    const providerId = seedProviderConfig('unique-client');

    const result = await backfillMicrosoftEmailProviderIssuerMetadata('tenant-1');

    expect(result.backfilled).toBe(0);
    const config = hoisted.state.microsoftEmailProviderConfigs.find(
      (row) => row.email_provider_id === providerId
    );
    expect(config?.microsoft_profile_id).toBeNull();
    expect(config?.client_secret_ref).toBeNull();
  });

  it('never backfills an email provider onto the tenant Teams app', async () => {
    seedProfiles([
      profile({
        profile_id: 'p-teams-app',
        client_id: '02c1ecbc-10db-4439-b002-1187acf7b268',
        capabilities: ['teams', 'email'],
        is_default: true,
      }),
    ]);
    hoisted.state.tenantSecrets.set('tenant-1:ref-1', 'secret-1');
    const providerId = seedProviderConfig('02c1ecbc-10db-4439-b002-1187acf7b268');

    const result = await backfillMicrosoftEmailProviderIssuerMetadata('tenant-1');

    expect(result.backfilled).toBe(0);
    const config = hoisted.state.microsoftEmailProviderConfigs.find(
      (row) => row.email_provider_id === providerId
    );
    expect(config?.microsoft_profile_id).toBeNull();
    expect(config?.client_secret_ref).toBeNull();
  });
});
