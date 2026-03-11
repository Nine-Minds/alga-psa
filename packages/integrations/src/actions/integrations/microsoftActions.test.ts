import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
    resetUpdates: [] as Array<{ table: string; where: Record<string, unknown>; values: Record<string, unknown> }>,
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
          rows.forEach((row) => {
            state.microsoftProfiles.push(clone(row) as MicrosoftProfileRecord);
          });
        }
        if (table === 'microsoft_profile_consumer_bindings') {
          rows.forEach((row) => {
            state.microsoftConsumerBindings.push(clone(row) as MicrosoftConsumerBindingRecord);
          });
        }
        if (table === 'teams_integrations') {
          rows.forEach((row) => {
            state.teamsIntegrations.push(clone(row) as TeamsIntegrationRecord);
          });
        }
        if (table === 'email_providers') {
          rows.forEach((row) => {
            state.emailProviders.push(clone(row) as EmailProviderRecord);
          });
        }
        if (table === 'calendar_providers') {
          rows.forEach((row) => {
            state.calendarProviders.push(clone(row) as CalendarProviderRecord);
          });
        }
        if (table === 'msp_sso_tenant_login_domains') {
          rows.forEach((row) => {
            state.mspSsoLoginDomains.push(clone(row) as MspSsoLoginDomainRecord);
          });
        }

        return rows.length;
      },
      async update(values: Record<string, unknown>) {
        if (
          table === 'microsoft_profiles' ||
          table === 'microsoft_profile_consumer_bindings' ||
          table === 'teams_integrations'
        ) {
          const rows = filteredRows();
          rows.forEach((row) => Object.assign(row, values));
          return rows.length;
        }

        state.resetUpdates.push({
          table,
          where: Object.assign({}, ...filters),
          values: clone(values),
        });
        return 1;
      },
      async delete() {
        const rows = filteredRows();
        if (table === 'microsoft_profiles') {
          const remaining = state.microsoftProfiles.filter((row) => !rows.includes(row as never));
          state.microsoftProfiles.splice(0, state.microsoftProfiles.length, ...remaining);
        }
        if (table === 'microsoft_profile_consumer_bindings') {
          const remaining = state.microsoftConsumerBindings.filter((row) => !rows.includes(row as never));
          state.microsoftConsumerBindings.splice(0, state.microsoftConsumerBindings.length, ...remaining);
        }
        if (table === 'teams_integrations') {
          const remaining = state.teamsIntegrations.filter((row) => !rows.includes(row as never));
          state.teamsIntegrations.splice(0, state.teamsIntegrations.length, ...remaining);
        }
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

const {
  tenantSecrets,
  appSecrets,
  microsoftProfiles,
  resetUpdates,
  microsoftConsumerBindings,
  teamsIntegrations,
  emailProviders,
  calendarProviders,
  mspSsoLoginDomains,
} = hoisted.state;
const { getTenantSecretMock, setTenantSecretMock, getAppSecretMock, hasPermissionMock, knexMock } = hoisted;

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

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
  archiveMicrosoftProfile,
  createMicrosoftProfile,
  deleteMicrosoftProfile,
  getMicrosoftIntegrationStatus,
  listMicrosoftConsumerBindings,
  listMicrosoftProfiles,
  resetMicrosoftProvidersToDisconnected,
  saveMicrosoftIntegrationSettings,
  setDefaultMicrosoftProfile,
  updateMicrosoftProfile,
} from './microsoftActions';

describe('Microsoft integration actions', () => {
  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.clear();
    appSecrets.clear();
    microsoftProfiles.length = 0;
    microsoftConsumerBindings.length = 0;
    teamsIntegrations.length = 0;
    emailProviders.length = 0;
    calendarProviders.length = 0;
    mspSsoLoginDomains.length = 0;
    resetUpdates.length = 0;
    hasPermissionMock.mockResolvedValue(true);
    getTenantSecretMock.mockClear();
    setTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
  });

  it('T001/T002/T023/T024/T033/T034/T373/T375: profile creation/listing stays tenant-scoped and excludes other tenants', async () => {
    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    await createMicrosoftProfile({
      displayName: 'Tenant Two Profile',
      clientId: 'tenant-two-client',
      clientSecret: 'tenant-two-secret',
      tenantId: 'tenant-two-guid',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    const createResult = await createMicrosoftProfile({
      displayName: 'Primary Profile',
      clientId: 'client-id-123',
      clientSecret: 'super-secret-value',
      tenantId: 'tenant-guid',
    });

    expect(createResult.success).toBe(true);

    const listResult = await listMicrosoftProfiles();
    expect(listResult.success).toBe(true);
    expect(listResult.profiles?.map((profile) => profile.displayName)).toEqual(['Primary Profile']);
    expect(listResult.profiles?.[0]?.tenantId).toBe('tenant-guid');
  });

  it('profile persistence stores metadata, secret refs, masked state, and CE-visible MSP SSO status from the secret provider', async () => {
    mspSsoLoginDomains.push({
      tenant: 'tenant-1',
      domain: 'ops.example.com',
      is_active: true,
    });

    const result = await createMicrosoftProfile({
      displayName: 'Ops Profile',
      clientId: 'ops-client-id',
      clientSecret: 'ops-secret-value',
      tenantId: 'ops-tenant-guid',
    });

    expect(result.success).toBe(true);
    expect(microsoftProfiles).toHaveLength(1);
    expect(microsoftProfiles[0]).toMatchObject({
      tenant: 'tenant-1',
      display_name: 'Ops Profile',
      client_id: 'ops-client-id',
      tenant_id: 'ops-tenant-guid',
      is_default: true,
      is_archived: false,
    });
    expect(microsoftProfiles[0].client_secret_ref).toMatch(/^microsoft_profile_.+_client_secret$/);
    expect(JSON.stringify(microsoftProfiles[0])).not.toContain('ops-secret-value');
    expect(tenantSecrets.get(`tenant-1:${microsoftProfiles[0].client_secret_ref}`)).toBe('ops-secret-value');
    expect(tenantSecrets.get('tenant-1:microsoft_client_secret')).toBe('ops-secret-value');

    const status = await getMicrosoftIntegrationStatus();
    expect(status.success).toBe(true);
    expect(status.profiles?.[0]).toMatchObject({
      displayName: 'Ops Profile',
      clientId: 'ops-client-id',
      tenantId: 'ops-tenant-guid',
      clientSecretConfigured: true,
      status: 'ready',
      consumers: ['MSP SSO'],
    });
    expect(status.profiles?.[0]?.clientSecretMasked).not.toContain('ops-secret-value');
    expect(status.profiles?.[0]?.readiness).toMatchObject({
      ready: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      tenantIdConfigured: true,
      active: true,
    });
  });

  it('T005/T006: profile names are unique within a tenant but reusable across tenants', async () => {
    await createMicrosoftProfile({
      displayName: 'Duplicate Name',
      clientId: 'client-id-1',
      clientSecret: 'secret-1',
      tenantId: 'tenant-guid-1',
    });

    const duplicate = await createMicrosoftProfile({
      displayName: ' duplicate   name ',
      clientId: 'client-id-2',
      clientSecret: 'secret-2',
      tenantId: 'tenant-guid-2',
    });

    expect(duplicate).toEqual({
      success: false,
      error: 'A Microsoft profile with this display name already exists',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    const otherTenant = await createMicrosoftProfile({
      displayName: 'Duplicate Name',
      clientId: 'client-id-3',
      clientSecret: 'secret-3',
      tenantId: 'tenant-guid-3',
    });

    expect(otherTenant.success).toBe(true);
  });

  it('T007/T008/T035/T036/T377/T378: exactly one profile is default and legacy secret mirroring follows the default profile', async () => {
    const first = await createMicrosoftProfile({
      displayName: 'First Profile',
      clientId: 'client-id-1',
      clientSecret: 'secret-1',
      tenantId: 'tenant-guid-1',
    });
    const second = await createMicrosoftProfile({
      displayName: 'Second Profile',
      clientId: 'client-id-2',
      clientSecret: 'secret-2',
      tenantId: 'tenant-guid-2',
    });

    expect(first.profile?.isDefault).toBe(true);
    expect(second.profile?.isDefault).toBe(false);

    const setDefault = await setDefaultMicrosoftProfile(second.profile!.profileId);
    expect(setDefault.success).toBe(true);

    const profiles = await listMicrosoftProfiles();
    expect(profiles.profiles?.filter((profile) => profile.isDefault)).toHaveLength(1);
    expect(profiles.profiles?.find((profile) => profile.isDefault)?.displayName).toBe('Second Profile');
    expect(tenantSecrets.get('tenant-1:microsoft_client_id')).toBe('client-id-2');
    expect(tenantSecrets.get('tenant-1:microsoft_client_secret')).toBe('secret-2');
    expect(tenantSecrets.get('tenant-1:microsoft_tenant_id')).toBe('tenant-guid-2');
  });

  it('T009/T010/T011/T012/T013/T014/T015/T016: legacy singleton secrets backfill a default profile and preserve current Microsoft values', async () => {
    tenantSecrets.set('tenant-1:microsoft_client_id', 'legacy-client-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'legacy-secret');
    tenantSecrets.set('tenant-1:microsoft_tenant_id', 'legacy-tenant-guid');

    const listResult = await listMicrosoftProfiles();

    expect(listResult.success).toBe(true);
    expect(listResult.profiles).toHaveLength(1);
    expect(listResult.profiles?.[0]).toMatchObject({
      displayName: 'Default Microsoft Profile',
      clientId: 'legacy-client-id',
      tenantId: 'legacy-tenant-guid',
      isDefault: true,
      clientSecretConfigured: true,
    });
    expect(listResult.profiles?.[0]?.clientSecretRef).toMatch(/^microsoft_profile_.+_client_secret$/);
    expect(tenantSecrets.get(`tenant-1:${listResult.profiles?.[0]?.clientSecretRef}`)).toBe('legacy-secret');
    expect(tenantSecrets.get('tenant-1:microsoft_client_id')).toBe('legacy-client-id');
    expect(tenantSecrets.get('tenant-1:microsoft_client_secret')).toBe('legacy-secret');
    expect(tenantSecrets.get('tenant-1:microsoft_tenant_id')).toBe('legacy-tenant-guid');
  });

  it('T021/T022: non-default profiles can be archived and remain visible as archived records', async () => {
    await createMicrosoftProfile({
      displayName: 'Default Profile',
      clientId: 'client-id-1',
      clientSecret: 'secret-1',
      tenantId: 'tenant-guid-1',
    });
    const secondary = await createMicrosoftProfile({
      displayName: 'Secondary Profile',
      clientId: 'client-id-2',
      clientSecret: 'secret-2',
      tenantId: 'tenant-guid-2',
    });

    const archiveResult = await archiveMicrosoftProfile(secondary.profile!.profileId);
    expect(archiveResult).toEqual({ success: true });

    const profiles = await listMicrosoftProfiles();
    expect(profiles.profiles?.find((profile) => profile.displayName === 'Secondary Profile')).toMatchObject({
      isArchived: true,
      status: 'archived',
    });
  });

  it('T025/T026/T027/T028: create validates required fields and update rotates secret without exposing the previous one', async () => {
    await expect(
      createMicrosoftProfile({
        displayName: '   ',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-guid',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Microsoft profile display name is required',
    });

    await expect(
      createMicrosoftProfile({
        displayName: 'Missing Tenant',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: '   ',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Microsoft Tenant ID is required',
    });

    const created = await createMicrosoftProfile({
      displayName: 'Rotation Profile',
      clientId: 'client-id',
      clientSecret: 'old-secret',
      tenantId: 'tenant-guid',
    });

    const preserveSecret = await updateMicrosoftProfile({
      profileId: created.profile!.profileId,
      displayName: 'Rotation Profile Updated',
      clientId: 'client-id-updated',
      tenantId: 'tenant-guid-updated',
      clientSecret: '',
    });

    expect(preserveSecret.success).toBe(true);
    expect(tenantSecrets.get(`tenant-1:${created.profile!.clientSecretRef}`)).toBe('old-secret');
    expect(preserveSecret.profile).toMatchObject({
      displayName: 'Rotation Profile Updated',
      clientId: 'client-id-updated',
      tenantId: 'tenant-guid-updated',
    });

    const rotateSecret = await updateMicrosoftProfile({
      profileId: created.profile!.profileId,
      clientSecret: 'new-secret',
    });

    expect(rotateSecret.success).toBe(true);
    expect(tenantSecrets.get(`tenant-1:${created.profile!.clientSecretRef}`)).toBe('new-secret');
    expect(rotateSecret.profile?.clientSecretMasked).not.toContain('new-secret');
  });

  it('T029/T030: archiving the default profile is blocked until another binding/default is selected', async () => {
    const created = await createMicrosoftProfile({
      displayName: 'Default Profile',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenantId: 'tenant-guid',
    });

    const archiveResult = await archiveMicrosoftProfile(created.profile!.profileId);

    expect(archiveResult).toEqual({
      success: false,
      error: 'Default Microsoft profile cannot be archived until another profile is default',
    });
  });

  it('T351/T352: binding backfill matches the mirrored legacy Microsoft credentials instead of the default-profile flag and fails closed when no unique candidate remains', async () => {
    const previousEdition = process.env.NEXT_PUBLIC_EDITION;
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    try {
      const defaultProfile = await createMicrosoftProfile({
        displayName: 'Default Profile',
        clientId: 'client-id-1',
        clientSecret: 'secret-1',
        tenantId: 'tenant-guid-1',
      });
      const secondaryProfile = await createMicrosoftProfile({
        displayName: 'Secondary Profile',
        clientId: 'client-id-2',
        clientSecret: 'secret-2',
        tenantId: 'tenant-guid-2',
      });

      emailProviders.push({
        id: 'email-provider-1',
        tenant: 'tenant-1',
        provider_type: 'microsoft',
      });
      tenantSecrets.set('tenant-1:microsoft_client_id', 'client-id-2');
      tenantSecrets.set('tenant-1:microsoft_client_secret', 'secret-2');
      tenantSecrets.set('tenant-1:microsoft_tenant_id', 'tenant-guid-2');

      const migrated = await listMicrosoftConsumerBindings();
      expect(migrated.success).toBe(true);
      expect(migrated.bindings?.find((binding) => binding.consumerType === 'email')).toEqual({
        consumerType: 'email',
        consumerLabel: 'Email',
        profileId: secondaryProfile.profile?.profileId,
        profileDisplayName: 'Secondary Profile',
        isArchived: false,
      });
      expect(migrated.bindings?.find((binding) => binding.consumerType === 'msp_sso')).toEqual({
        consumerType: 'msp_sso',
        consumerLabel: 'MSP SSO',
        profileId: null,
        profileDisplayName: undefined,
        isArchived: false,
      });

      microsoftConsumerBindings.length = 0;
      tenantSecrets.delete('tenant-1:microsoft_client_id');
      tenantSecrets.delete('tenant-1:microsoft_client_secret');
      tenantSecrets.delete('tenant-1:microsoft_tenant_id');

      const failedClosed = await listMicrosoftConsumerBindings();
      expect(failedClosed.success).toBe(true);
      expect(failedClosed.bindings?.find((binding) => binding.consumerType === 'email')).toEqual({
        consumerType: 'email',
        consumerLabel: 'Email',
        profileId: null,
        profileDisplayName: undefined,
        isArchived: false,
      });
      expect(defaultProfile.profile?.isDefault).toBe(true);
    } finally {
      if (previousEdition === undefined) {
        delete process.env.NEXT_PUBLIC_EDITION;
      } else {
        process.env.NEXT_PUBLIC_EDITION = previousEdition;
      }
    }
  });

  it('returns CE status metadata with only MSP SSO guidance and masked profile data', async () => {
    const originalEdition = process.env.NEXT_PUBLIC_EDITION;
    process.env.NEXT_PUBLIC_EDITION = 'community';

    try {
      appSecrets.set('NEXT_PUBLIC_BASE_URL', 'https://example.com');
      mspSsoLoginDomains.push({
        tenant: 'tenant-1',
        domain: 'ce.example.com',
        is_active: true,
      });

      await saveMicrosoftIntegrationSettings({
        clientId: 'client-id-123',
        clientSecret: 'super-secret-value',
        tenantId: 'tenant-guid',
      });

      const result = await getMicrosoftIntegrationStatus();

      expect(result.success).toBe(true);
      expect(result.config?.clientId).toBe('client-id-123');
      expect(result.config?.clientSecretMasked?.endsWith('alue')).toBe(true);
      expect(result.config?.clientSecretMasked).not.toContain('super-secret-value');
      expect(result.redirectUris?.sso).toBe('https://example.com/api/auth/callback/azure-ad');
      expect(result.redirectUris?.email).toBeUndefined();
      expect(result.redirectUris?.calendar).toBeUndefined();
      expect(result.redirectUris?.teamsTab).toBeUndefined();
      expect(result.scopes?.sso).toContain('openid');
      expect(result.scopes?.email).toBeUndefined();
      expect(result.scopes?.calendar).toBeUndefined();
      expect(result.scopes?.teams).toBeUndefined();
      expect(result.profiles?.[0]?.displayName).toBe('Default Microsoft Profile');
      expect(result.profiles?.[0]?.consumers).toEqual(['MSP SSO']);
    } finally {
      if (originalEdition === undefined) {
        delete process.env.NEXT_PUBLIC_EDITION;
      } else {
        process.env.NEXT_PUBLIC_EDITION = originalEdition;
      }
    }
  });

  it('returns EE status metadata with email, calendar, and Teams guidance when enterprise edition is enabled', async () => {
    const originalEdition = process.env.NEXT_PUBLIC_EDITION;
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    try {
      appSecrets.set('NEXT_PUBLIC_BASE_URL', 'https://example.com');
      mspSsoLoginDomains.push({
        tenant: 'tenant-1',
        domain: 'ee.example.com',
        is_active: true,
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

      await saveMicrosoftIntegrationSettings({
        clientId: 'client-id-123',
        clientSecret: 'super-secret-value',
        tenantId: 'tenant-guid',
      });

      const result = await getMicrosoftIntegrationStatus();

      expect(result.success).toBe(true);
      expect(result.redirectUris?.email).toBe('https://example.com/api/auth/microsoft/callback');
      expect(result.redirectUris?.calendar).toBe('https://example.com/api/auth/microsoft/calendar/callback');
      expect(result.redirectUris?.teamsTab).toBe('https://example.com/api/teams/auth/callback/tab');
      expect(result.redirectUris?.teamsBot).toBe('https://example.com/api/teams/auth/callback/bot');
      expect(result.redirectUris?.teamsMessageExtension).toBe(
        'https://example.com/api/teams/auth/callback/message-extension'
      );
      expect(result.scopes?.email?.length).toBeGreaterThan(0);
      expect(result.scopes?.calendar?.length).toBeGreaterThan(0);
      expect(result.scopes?.teams).toEqual(['openid', 'profile', 'email', 'offline_access']);
      expect([...(result.profiles?.[0]?.consumers || [])].sort()).toEqual([
        'Calendar',
        'Email',
        'MSP SSO',
      ]);
    } finally {
      if (originalEdition === undefined) {
        delete process.env.NEXT_PUBLIC_EDITION;
      } else {
        process.env.NEXT_PUBLIC_EDITION = originalEdition;
      }
    }
  });

  it('T011/T012: reset action disconnects Microsoft email and calendar providers', async () => {
    const result = await resetMicrosoftProvidersToDisconnected();

    expect(result).toEqual({ success: true });
    expect(resetUpdates.some((u) => u.table === 'email_providers' && u.where.provider_type === 'microsoft')).toBe(true);
    expect(resetUpdates.some((u) => u.table === 'calendar_providers' && u.where.provider_type === 'microsoft')).toBe(true);
    expect(
      resetUpdates.some(
        (u) =>
          u.table === 'microsoft_email_provider_config' &&
          Object.prototype.hasOwnProperty.call(u.values, 'access_token') &&
          u.values.access_token === null
      )
    ).toBe(true);
    expect(
      resetUpdates.some(
        (u) =>
          u.table === 'microsoft_calendar_provider_config' &&
          Object.prototype.hasOwnProperty.call(u.values, 'delta_link') &&
          u.values.delta_link === null
      )
    ).toBe(true);
  });

  it('T013: Microsoft actions export the binding-driven API surface from integrations action indexes', () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const integrationsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/integrations/index.ts'),
      'utf8'
    );
    const rootActionsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/index.ts'),
      'utf8'
    );

    expect(integrationsIndex).toContain("from './microsoftActions';");
    expect(integrationsIndex).toContain('listMicrosoftProfiles');
    expect(integrationsIndex).toContain('createMicrosoftProfile');
    expect(integrationsIndex).toContain('resolveMicrosoftProfileForConsumer');
    expect(integrationsIndex).not.toContain('resolveMicrosoftProfileForCompatibility');
    expect(rootActionsIndex).toContain('listMicrosoftProfiles');
    expect(rootActionsIndex).toContain('createMicrosoftProfile');
    expect(rootActionsIndex).toContain('resolveMicrosoftProfileForConsumer');
    expect(rootActionsIndex).not.toContain('resolveMicrosoftProfileForCompatibility');
  });

  it('T014/T381/T382: non-admin user receives permission error on create/update/archive/default/save', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(
      createMicrosoftProfile({
        displayName: 'client-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-guid',
      })
    ).resolves.toEqual({ success: false, error: 'Forbidden' });

    await expect(
      saveMicrosoftIntegrationSettings({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-guid',
      })
    ).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it('T015: client-portal users are denied on list/create/update/archive/default/status/save/reset', async () => {
    hoisted.state.mockUser = { user_id: 'client-1', user_type: 'client' };

    await expect(listMicrosoftProfiles()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(
      createMicrosoftProfile({
        displayName: 'client-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-guid',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(getMicrosoftIntegrationStatus()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(
      saveMicrosoftIntegrationSettings({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-guid',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(resetMicrosoftProvidersToDisconnected()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
  });

  it('T373/T374/T375/T376/T441/T442: shared Microsoft profile CRUD remains available in both CE and EE editions because the actions stay edition-agnostic', async () => {
    const originalEdition = process.env.NEXT_PUBLIC_EDITION;

    try {
      process.env.NEXT_PUBLIC_EDITION = 'community';

      const ceCreate = await createMicrosoftProfile({
        displayName: 'CE Profile',
        clientId: 'ce-client-id',
        clientSecret: 'ce-secret',
        tenantId: 'ce-tenant-guid',
      });
      expect(ceCreate.success).toBe(true);
      expect((await listMicrosoftProfiles()).profiles?.map((profile) => profile.displayName)).toContain('CE Profile');

      microsoftProfiles.length = 0;
      tenantSecrets.clear();

      process.env.NEXT_PUBLIC_EDITION = 'enterprise';

      const eeCreate = await createMicrosoftProfile({
        displayName: 'EE Profile',
        clientId: 'ee-client-id',
        clientSecret: 'ee-secret',
        tenantId: 'ee-tenant-guid',
      });
      expect(eeCreate.success).toBe(true);
      expect((await listMicrosoftProfiles()).profiles?.map((profile) => profile.displayName)).toContain('EE Profile');
    } finally {
      if (originalEdition === undefined) {
        delete process.env.NEXT_PUBLIC_EDITION;
      } else {
        process.env.NEXT_PUBLIC_EDITION = originalEdition;
      }
    }
  });

  it('T475/T476: archiving a Teams-selected profile is blocked until Teams is rebound or deactivated', async () => {
    await createMicrosoftProfile({
      displayName: 'Default Profile',
      clientId: 'default-client-id',
      clientSecret: 'default-secret',
      tenantId: 'tenant-guid-1',
    });
    const teamsProfile = await createMicrosoftProfile({
      displayName: 'Teams Profile',
      clientId: 'teams-client-id',
      clientSecret: 'teams-secret',
      tenantId: 'tenant-guid-2',
    });

    teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: teamsProfile.profile!.profileId,
      install_status: 'active',
      enabled_capabilities: ['personal_tab'],
      notification_categories: ['assignment'],
      allowed_actions: ['assign_ticket'],
      app_id: 'teams-client-id',
      bot_id: 'teams-client-id',
      package_metadata: { fileName: 'teams.zip' },
      last_error: null,
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: new Date('2026-03-07T10:00:00.000Z'),
      updated_at: new Date('2026-03-07T10:00:00.000Z'),
    });

    await expect(archiveMicrosoftProfile(teamsProfile.profile!.profileId)).resolves.toEqual({
      success: false,
      error: 'Microsoft profile is still bound to Teams and cannot be archived until Teams is rebound or deactivated',
    });

    teamsIntegrations[0].install_status = 'not_configured';

    await expect(archiveMicrosoftProfile(teamsProfile.profile!.profileId)).resolves.toEqual({
      success: true,
    });
  });

  it('T477/T478: deleting a Teams-selected profile is blocked while active and clears inactive Teams references before removing the profile', async () => {
    await createMicrosoftProfile({
      displayName: 'Default Profile',
      clientId: 'default-client-id',
      clientSecret: 'default-secret',
      tenantId: 'tenant-guid-1',
    });
    const removable = await createMicrosoftProfile({
      displayName: 'Removable Teams Profile',
      clientId: 'removable-client-id',
      clientSecret: 'removable-secret',
      tenantId: 'tenant-guid-2',
    });

    teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: removable.profile!.profileId,
      install_status: 'active',
      enabled_capabilities: ['personal_tab'],
      notification_categories: ['assignment'],
      allowed_actions: ['assign_ticket'],
      app_id: 'removable-client-id',
      bot_id: 'removable-client-id',
      package_metadata: { fileName: 'teams.zip' },
      last_error: null,
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: new Date('2026-03-07T10:00:00.000Z'),
      updated_at: new Date('2026-03-07T10:00:00.000Z'),
    });

    await expect(deleteMicrosoftProfile(removable.profile!.profileId)).resolves.toEqual({
      success: false,
      error: 'Microsoft profile is still bound to Teams and cannot be deleted until Teams is rebound or deactivated',
    });

    teamsIntegrations[0].install_status = 'not_configured';

    await expect(deleteMicrosoftProfile(removable.profile!.profileId)).resolves.toEqual({
      success: true,
    });
    expect(microsoftProfiles.find((profile) => profile.profile_id === removable.profile!.profileId)).toBeUndefined();
    expect(tenantSecrets.get(`tenant-1:${removable.profile!.clientSecretRef}`)).toBeUndefined();
    expect(teamsIntegrations[0]).toMatchObject({
      selected_profile_id: null,
      app_id: null,
      bot_id: null,
      package_metadata: null,
      last_error: null,
      install_status: 'not_configured',
    });
  });
});
