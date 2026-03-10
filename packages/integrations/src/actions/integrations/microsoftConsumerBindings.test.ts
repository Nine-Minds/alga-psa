import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type MicrosoftProfileRecord = {
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

  type MicrosoftConsumerBindingRecord = {
    tenant: string;
    consumer_type: 'msp_sso' | 'email' | 'calendar' | 'teams';
    profile_id: string;
    created_by: string | null;
    updated_by: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  };

  type TeamsIntegrationRecord = {
    tenant: string;
    selected_profile_id: string | null;
    install_status: 'not_configured' | 'install_pending' | 'active' | 'error';
    enabled_capabilities: string[];
    notification_categories: string[];
    allowed_actions: string[];
    app_id?: string | null;
    bot_id?: string | null;
    package_metadata?: Record<string, unknown> | null;
    last_error: string | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  };

  type EmailProviderRecord = {
    id: string;
    tenant: string;
    provider_type: string;
  };

  type CalendarProviderRecord = {
    id: string;
    tenant: string;
    provider_type: string;
  };

  type MspSsoLoginDomainRecord = {
    tenant: string;
    domain: string;
    is_active: boolean;
  };

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as MicrosoftProfileRecord[],
    microsoftConsumerBindings: [] as MicrosoftConsumerBindingRecord[],
    teamsIntegrations: [] as TeamsIntegrationRecord[],
    emailProviders: [] as EmailProviderRecord[],
    calendarProviders: [] as CalendarProviderRecord[],
    mspSsoLoginDomains: [] as MspSsoLoginDomainRecord[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];

    const getRows = () => {
      if (table === 'microsoft_profiles') {
        return state.microsoftProfiles;
      }
      if (table === 'microsoft_profile_consumer_bindings') {
        return state.microsoftConsumerBindings;
      }
      if (table === 'teams_integrations') {
        return state.teamsIntegrations;
      }
      if (table === 'email_providers') {
        return state.emailProviders;
      }
      if (table === 'calendar_providers') {
        return state.calendarProviders;
      }
      if (table === 'msp_sso_tenant_login_domains') {
        return state.mspSsoLoginDomains;
      }

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
          rows.forEach((row) => state.microsoftProfiles.push(clone(row) as MicrosoftProfileRecord));
        }
        if (table === 'microsoft_profile_consumer_bindings') {
          rows.forEach((row) => state.microsoftConsumerBindings.push(clone(row) as MicrosoftConsumerBindingRecord));
        }
        if (table === 'teams_integrations') {
          rows.forEach((row) => state.teamsIntegrations.push(clone(row) as TeamsIntegrationRecord));
        }
        if (table === 'email_providers') {
          rows.forEach((row) => state.emailProviders.push(clone(row) as EmailProviderRecord));
        }
        if (table === 'calendar_providers') {
          rows.forEach((row) => state.calendarProviders.push(clone(row) as CalendarProviderRecord));
        }
        if (table === 'msp_sso_tenant_login_domains') {
          rows.forEach((row) => state.mspSsoLoginDomains.push(clone(row) as MspSsoLoginDomainRecord));
        }

        return rows.length;
      },
      async update(values: Record<string, unknown>) {
        const rows = filteredRows();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
    };
  };

  const knexMock: any = ((table: string) => createQuery(table)) as any;
  knexMock.fn = {
    now: vi.fn(() => 'now()'),
  };
  knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);

  return {
    state,
    getTenantSecretMock: vi.fn(async (tenant: string, key: string) => {
      return state.tenantSecrets.get(`${tenant}:${key}`) || null;
    }),
    setTenantSecretMock: vi.fn(async (tenant: string, key: string, value: string | null) => {
      if (value === null) {
        state.tenantSecrets.delete(`${tenant}:${key}`);
        return;
      }

      state.tenantSecrets.set(`${tenant}:${key}`, value);
    }),
    getAppSecretMock: vi.fn(async (key: string) => state.appSecrets.get(key) || null),
    hasPermissionMock: vi.fn(async (..._args: unknown[]) => true),
    knexMock,
  };
});

const {
  tenantSecrets,
  appSecrets,
  microsoftProfiles,
  microsoftConsumerBindings,
  teamsIntegrations,
  emailProviders,
  calendarProviders,
  mspSsoLoginDomains,
} = hoisted.state;
const {
  getTenantSecretMock,
  setTenantSecretMock,
  getAppSecretMock,
  hasPermissionMock,
  knexMock,
} = hoisted;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => null),
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecretMock,
    setTenantSecret: hoisted.setTenantSecretMock,
    getAppSecret: hoisted.getAppSecretMock,
  }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
}));

import {
  createMicrosoftProfile,
  listMicrosoftConsumerBindings,
  resolveMicrosoftProfileForConsumer,
  setMicrosoftConsumerBinding,
} from './microsoftActions';

describe('Microsoft consumer binding actions', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    delete process.env.NEXT_PUBLIC_EDITION;
    tenantSecrets.clear();
    appSecrets.clear();
    microsoftProfiles.length = 0;
    microsoftConsumerBindings.length = 0;
    teamsIntegrations.length = 0;
    emailProviders.length = 0;
    calendarProviders.length = 0;
    mspSsoLoginDomains.length = 0;
    hasPermissionMock.mockResolvedValue(true);
    getTenantSecretMock.mockClear();
    setTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
  });

  it('returns only the CE-visible MSP SSO binding and materializes only migration-needed rows', async () => {
    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    tenantSecrets.set('tenant-2:microsoft_client_id', 'tenant-two-client');
    tenantSecrets.set('tenant-2:microsoft_client_secret', 'tenant-two-secret');
    tenantSecrets.set('tenant-2:microsoft_tenant_id', 'tenant-two-guid');
    mspSsoLoginDomains.push({
      tenant: 'tenant-2',
      domain: 'tenant-two.example.com',
      is_active: true,
    });
    await listMicrosoftConsumerBindings();

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.set('tenant-1:microsoft_client_id', 'tenant-one-client');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'tenant-one-secret');
    tenantSecrets.set('tenant-1:microsoft_tenant_id', 'tenant-one-guid');
    mspSsoLoginDomains.push({
      tenant: 'tenant-1',
      domain: 'tenant-one.example.com',
      is_active: true,
    });

    const result = await listMicrosoftConsumerBindings();

    expect(result.success).toBe(true);
    expect(result.bindings?.map((binding) => binding.consumerType)).toEqual(['msp_sso']);
    expect(result.bindings?.every((binding) => binding.profileDisplayName === 'Default Microsoft Profile')).toBe(true);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-1')).toEqual([
      expect.objectContaining({ consumer_type: 'msp_sso' }),
    ]);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-2')).toEqual([
      expect.objectContaining({ consumer_type: 'msp_sso' }),
    ]);
  });

  it('returns all supported EE bindings and allows per-consumer reassignment in enterprise edition', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const primary = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });
    const secondary = await createMicrosoftProfile({
      displayName: 'Secondary Profile',
      clientId: 'secondary-client-id',
      clientSecret: 'secondary-secret',
      tenantId: 'tenant-guid-2',
    });

    const primaryProfileId = primary.profile?.profileId;
    const secondaryProfileId = secondary.profile?.profileId;
    expect(primaryProfileId).toBeTruthy();
    expect(secondaryProfileId).toBeTruthy();

    teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: primaryProfileId!,
      install_status: 'active',
      enabled_capabilities: ['personal_tab'],
      notification_categories: ['assignment'],
      allowed_actions: ['assign_ticket'],
      app_id: 'teams-app-id',
      bot_id: 'teams-bot-id',
      package_metadata: { fileName: 'teams.zip' },
      last_error: 'old error',
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: new Date('2026-03-07T10:00:00.000Z'),
      updated_at: new Date('2026-03-07T10:00:00.000Z'),
    });
    emailProviders.push({
      id: 'email-provider-1',
      tenant: 'tenant-1',
      provider_type: 'microsoft',
    });
    calendarProviders.push({
      id: 'calendar-provider-1',
      tenant: 'tenant-1',
      provider_type: 'microsoft',
    });
    mspSsoLoginDomains.push({
      tenant: 'tenant-1',
      domain: 'acme.example.com',
      is_active: true,
    });

    const initialEeBindings = await listMicrosoftConsumerBindings();
    expect(initialEeBindings.success).toBe(true);
    expect(initialEeBindings.bindings?.map((binding) => binding.consumerType)).toEqual([
      'msp_sso',
      'email',
      'calendar',
      'teams',
    ]);
    expect(initialEeBindings.bindings?.find((binding) => binding.consumerType === 'teams')).toMatchObject({
      consumerType: 'teams',
      profileId: null,
    });
    expect(initialEeBindings.bindings?.find((binding) => binding.consumerType === 'msp_sso')).toMatchObject({
      profileId: primaryProfileId,
    });
    expect(initialEeBindings.bindings?.find((binding) => binding.consumerType === 'email')).toMatchObject({
      profileId: primaryProfileId,
    });
    expect(initialEeBindings.bindings?.find((binding) => binding.consumerType === 'calendar')).toMatchObject({
      profileId: primaryProfileId,
    });

    const initialBinding = await setMicrosoftConsumerBinding({
      consumerType: 'teams',
      profileId: primaryProfileId!,
    });
    expect(initialBinding.success).toBe(true);

    const updatedBinding = await setMicrosoftConsumerBinding({
      consumerType: 'teams',
      profileId: secondaryProfileId!,
    });
    expect(updatedBinding.success).toBe(true);

    const eeBindings = await listMicrosoftConsumerBindings();
    expect(eeBindings.success).toBe(true);
    expect(new Set(eeBindings.bindings?.map((binding) => binding.consumerType))).toEqual(
      new Set(['msp_sso', 'email', 'calendar', 'teams'])
    );

    const teamsBindings = microsoftConsumerBindings.filter(
      (binding) => binding.tenant === 'tenant-1' && binding.consumer_type === 'teams'
    );
    expect(teamsBindings).toHaveLength(1);
    expect(teamsBindings[0].profile_id).toBe(secondaryProfileId);
    expect(updatedBinding.binding?.profileDisplayName).toBe('Secondary Profile');
    expect(teamsIntegrations[0]).toMatchObject({
      selected_profile_id: secondaryProfileId,
      install_status: 'install_pending',
      app_id: null,
      bot_id: null,
      package_metadata: null,
      last_error: null,
    });
    expect(
      microsoftConsumerBindings
        .filter((binding) => binding.tenant === 'tenant-1' && binding.consumer_type !== 'teams')
        .map((binding) => `${binding.consumer_type}:${binding.profile_id}`)
        .sort()
    ).toEqual([
      `msp_sso:${primaryProfileId}`,
      `email:${primaryProfileId}`,
      `calendar:${primaryProfileId}`,
    ].sort());

    const invalidConsumer = await setMicrosoftConsumerBinding({
      consumerType: 'unsupported' as any,
      profileId: secondaryProfileId!,
    });
    expect(invalidConsumer).toEqual({
      success: false,
      error: 'Unsupported Microsoft consumer type',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    const otherTenantProfile = await createMicrosoftProfile({
      displayName: 'Other Tenant Profile',
      clientId: 'tenant-two-client-id',
      clientSecret: 'tenant-two-secret',
      tenantId: 'tenant-two-guid',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    const crossTenantBinding = await setMicrosoftConsumerBinding({
      consumerType: 'teams',
      profileId: otherTenantProfile.profile!.profileId,
    });
    expect(crossTenantBinding).toEqual({
      success: false,
      error: 'Microsoft profile not found',
    });
  });

  it('T367/T368: enterprise migration leaves tenants with no Microsoft profiles or legacy usage fully unbound and tenant-scoped', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    await createMicrosoftProfile({
      displayName: 'Other Tenant Profile',
      clientId: 'tenant-two-client-id',
      clientSecret: 'tenant-two-secret',
      tenantId: 'tenant-two-guid',
    });
    calendarProviders.push({
      id: 'calendar-provider-2',
      tenant: 'tenant-2',
      provider_type: 'microsoft',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };

    const result = await listMicrosoftConsumerBindings();

    expect(result.success).toBe(true);
    expect(result.bindings).toEqual([
      expect.objectContaining({ consumerType: 'msp_sso', profileId: null }),
      expect.objectContaining({ consumerType: 'email', profileId: null }),
      expect.objectContaining({ consumerType: 'calendar', profileId: null }),
      expect.objectContaining({ consumerType: 'teams', profileId: null }),
    ]);
    expect(microsoftProfiles.filter((profile) => profile.tenant === 'tenant-1')).toEqual([]);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-1')).toEqual([]);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-2')).toEqual([]);
  });

  it('T369/T370/T371/T372: migration binds an existing default profile to legacy calendar usage without touching other consumers or tenants', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const primary = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    await createMicrosoftProfile({
      displayName: 'Other Tenant Profile',
      clientId: 'tenant-two-client-id',
      clientSecret: 'tenant-two-secret',
      tenantId: 'tenant-two-guid',
    });
    calendarProviders.push({
      id: 'calendar-provider-2',
      tenant: 'tenant-2',
      provider_type: 'microsoft',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    calendarProviders.push({
      id: 'calendar-provider-1',
      tenant: 'tenant-1',
      provider_type: 'microsoft',
    });

    const result = await listMicrosoftConsumerBindings();

    expect(result.success).toBe(true);
    expect(result.bindings).toEqual([
      expect.objectContaining({ consumerType: 'msp_sso', profileId: null }),
      expect.objectContaining({ consumerType: 'email', profileId: null }),
      expect.objectContaining({
        consumerType: 'calendar',
        profileId: primary.profile!.profileId,
        profileDisplayName: 'Primary Profile',
      }),
      expect.objectContaining({ consumerType: 'teams', profileId: null }),
    ]);
    expect(microsoftProfiles.filter((profile) => profile.tenant === 'tenant-1')).toHaveLength(1);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-1')).toEqual([
      expect.objectContaining({
        consumer_type: 'calendar',
        profile_id: primary.profile!.profileId,
      }),
    ]);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-2')).toEqual([]);
  });

  it('rejects EE-only binding writes in CE while keeping MSP SSO available', async () => {
    const created = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });

    expect(
      await setMicrosoftConsumerBinding({
        consumerType: 'msp_sso',
        profileId: created.profile!.profileId,
      })
    ).toMatchObject({
      success: true,
      binding: {
        consumerType: 'msp_sso',
        profileDisplayName: 'Primary Profile',
      },
    });

    await expect(
      setMicrosoftConsumerBinding({
        consumerType: 'email',
        profileId: created.profile!.profileId,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Microsoft consumer type is unavailable in this edition',
    });

    await expect(
      setMicrosoftConsumerBinding({
        consumerType: 'calendar',
        profileId: created.profile!.profileId,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Microsoft consumer type is unavailable in this edition',
    });

    await expect(
      setMicrosoftConsumerBinding({
        consumerType: 'teams',
        profileId: created.profile!.profileId,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Microsoft consumer type is unavailable in this edition',
    });
  });

  it('returns no migrated consumer profile when there is no explicit binding or legacy usage to migrate', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const created = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });

    const bindings = await listMicrosoftConsumerBindings();
    expect(bindings.success).toBe(true);
    expect(bindings.bindings).toEqual([
      expect.objectContaining({ consumerType: 'msp_sso', profileId: null }),
      expect.objectContaining({ consumerType: 'email', profileId: null }),
      expect.objectContaining({ consumerType: 'calendar', profileId: null }),
      expect.objectContaining({ consumerType: 'teams', profileId: null }),
    ]);

    expect(await resolveMicrosoftProfileForConsumer('tenant-1', 'msp_sso')).toBeNull();
    expect(await resolveMicrosoftProfileForConsumer('tenant-1', 'email')).toBeNull();
    expect(await resolveMicrosoftProfileForConsumer('tenant-1', 'calendar')).toBeNull();
    expect(created.success).toBe(true);
  });

  it('T367-T374: migration binding materialization handles no-profile, sole-profile, calendar-alignment, and archived-profile tenant states', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const emptyTenant = await listMicrosoftConsumerBindings();
    expect(emptyTenant.success).toBe(true);
    expect(emptyTenant.bindings).toEqual([
      expect.objectContaining({ consumerType: 'msp_sso', profileId: null }),
      expect.objectContaining({ consumerType: 'email', profileId: null }),
      expect.objectContaining({ consumerType: 'calendar', profileId: null }),
      expect.objectContaining({ consumerType: 'teams', profileId: null }),
    ]);
    expect(microsoftProfiles).toHaveLength(0);
    expect(microsoftConsumerBindings).toHaveLength(0);

    const created = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });
    calendarProviders.push({
      id: 'calendar-provider-1',
      tenant: 'tenant-1',
      provider_type: 'microsoft',
    });

    const aligned = await listMicrosoftConsumerBindings();
    expect(aligned.success).toBe(true);
    expect(aligned.bindings?.find((binding) => binding.consumerType === 'calendar')).toEqual({
      consumerType: 'calendar',
      consumerLabel: 'Calendar',
      profileId: created.profile!.profileId,
      profileDisplayName: 'Primary Profile',
      isArchived: false,
    });
    expect(microsoftConsumerBindings.filter((binding) => binding.consumer_type === 'calendar')).toEqual([
      expect.objectContaining({
        tenant: 'tenant-1',
        consumer_type: 'calendar',
        profile_id: created.profile!.profileId,
      }),
    ]);

    const profileRow = microsoftProfiles.find((profile) => profile.profile_id === created.profile!.profileId);
    expect(profileRow).toBeTruthy();
    profileRow!.is_archived = true;
    profileRow!.archived_at = new Date('2026-03-09T12:00:00.000Z').toISOString();
    microsoftConsumerBindings.length = 0;

    const archivedOnly = await listMicrosoftConsumerBindings();
    expect(archivedOnly.success).toBe(true);
    expect(archivedOnly.bindings?.find((binding) => binding.consumerType === 'calendar')).toEqual({
      consumerType: 'calendar',
      consumerLabel: 'Calendar',
      profileId: null,
      profileDisplayName: undefined,
      isArchived: false,
    });
    expect(microsoftConsumerBindings).toHaveLength(0);
  });

  it('requires an explicit Teams binding instead of falling back to a default Microsoft profile', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const created = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'primary-client-id',
      clientSecret: 'primary-secret',
      tenantId: 'tenant-guid-1',
    });

    expect(await resolveMicrosoftProfileForConsumer('tenant-1', 'teams')).toBeNull();
    expect(await resolveMicrosoftProfileForConsumer('tenant-1', 'unsupported')).toBeNull();

    await setMicrosoftConsumerBinding({
      consumerType: 'teams',
      profileId: created.profile!.profileId,
    });

    const resolvedTeams = await resolveMicrosoftProfileForConsumer('tenant-1', 'teams');
    expect(resolvedTeams?.profileId).toBe(created.profile!.profileId);
    expect(resolvedTeams?.consumers).toEqual(['Teams']);
  });

  it('T373/T374: rejects archived profiles and permission failures when saving bindings', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const active = await createMicrosoftProfile({
      displayName: 'Active Profile',
      clientId: 'active-client-id',
      clientSecret: 'active-secret',
      tenantId: 'tenant-guid-1',
    });
    const archived = await createMicrosoftProfile({
      displayName: 'Archived Profile',
      clientId: 'archived-client-id',
      clientSecret: 'archived-secret',
      tenantId: 'tenant-guid-2',
    });

    const archivedRow = microsoftProfiles.find((profile) => profile.profile_id === archived.profile!.profileId);
    expect(archivedRow).toBeTruthy();
    archivedRow!.is_archived = true;

    await expect(
      setMicrosoftConsumerBinding({
        consumerType: 'email',
        profileId: archived.profile!.profileId,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Archived Microsoft profiles cannot be bound to consumers',
    });

    hasPermissionMock.mockResolvedValue(false);

    await expect(
      setMicrosoftConsumerBinding({
        consumerType: 'email',
        profileId: active.profile!.profileId,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
  });

  it('T375/T376: rejects cross-tenant binding writes during migration cleanup', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const tenantOne = await createMicrosoftProfile({
      displayName: 'Tenant One Profile',
      clientId: 'tenant-one-client-id',
      clientSecret: 'tenant-one-secret',
      tenantId: 'tenant-one-guid',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    const tenantTwo = await createMicrosoftProfile({
      displayName: 'Tenant Two Profile',
      clientId: 'tenant-two-client-id',
      clientSecret: 'tenant-two-secret',
      tenantId: 'tenant-two-guid',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    const result = await setMicrosoftConsumerBinding({
      consumerType: 'calendar',
      profileId: tenantTwo.profile!.profileId,
    });

    expect(result).toEqual({
      success: false,
      error: 'Microsoft profile not found',
    });
    expect(await setMicrosoftConsumerBinding({
      consumerType: 'calendar',
      profileId: tenantOne.profile!.profileId,
    })).toMatchObject({
      success: true,
      binding: {
        consumerType: 'calendar',
        profileDisplayName: 'Tenant One Profile',
      },
    });
  });
});
