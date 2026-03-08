import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as MicrosoftProfileRecord[],
    microsoftConsumerBindings: [] as MicrosoftConsumerBindingRecord[],
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
  MICROSOFT_PROFILE_CONSUMERS,
  createMicrosoftProfile,
  listMicrosoftConsumerBindings,
  resolveMicrosoftProfileForConsumer,
  setMicrosoftConsumerBinding,
} from './microsoftActions';

describe('Microsoft consumer binding actions', () => {
  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.clear();
    appSecrets.clear();
    microsoftProfiles.length = 0;
    microsoftConsumerBindings.length = 0;
    hasPermissionMock.mockResolvedValue(true);
    getTenantSecretMock.mockClear();
    setTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
  });

  it('T079/T080: creates tenant-scoped compatibility bindings for migrated legacy Microsoft consumers', async () => {
    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    tenantSecrets.set('tenant-2:microsoft_client_id', 'tenant-two-client');
    tenantSecrets.set('tenant-2:microsoft_client_secret', 'tenant-two-secret');
    tenantSecrets.set('tenant-2:microsoft_tenant_id', 'tenant-two-guid');
    await listMicrosoftConsumerBindings();

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.set('tenant-1:microsoft_client_id', 'tenant-one-client');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'tenant-one-secret');
    tenantSecrets.set('tenant-1:microsoft_tenant_id', 'tenant-one-guid');

    const result = await listMicrosoftConsumerBindings();

    expect(result.success).toBe(true);
    expect(result.bindings?.map((binding) => binding.consumerType).sort()).toEqual([
      'calendar',
      'email',
      'msp_sso',
    ]);
    expect(result.bindings?.every((binding) => binding.profileDisplayName === 'Default Microsoft Profile')).toBe(true);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-1')).toHaveLength(3);
    expect(microsoftConsumerBindings.filter((binding) => binding.tenant === 'tenant-2')).toHaveLength(3);
  });

  it('T075/T076/T077/T078: supports MSP SSO, email, calendar, and Teams bindings with one selected profile per consumer', async () => {
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

    const supportedConsumers = new Set(
      MICROSOFT_PROFILE_CONSUMERS.filter((consumer) =>
        ['msp_sso', 'email', 'calendar', 'teams'].includes(consumer)
      )
    );
    expect(supportedConsumers).toEqual(new Set(['msp_sso', 'email', 'calendar', 'teams']));

    const teamsBindings = microsoftConsumerBindings.filter(
      (binding) => binding.tenant === 'tenant-1' && binding.consumer_type === 'teams'
    );
    expect(teamsBindings).toHaveLength(1);
    expect(teamsBindings[0].profile_id).toBe(secondaryProfileId);

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

  it('T081/T082: requires an explicit Teams binding instead of falling back to a default Microsoft profile', async () => {
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
});
