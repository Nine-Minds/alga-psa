import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for tenantDb(): just enough query-builder for the consent
// writer and the reconcile (where/whereNotNull/orderBy/forUpdate/first/update/
// insert + onConflict().ignore().returning()).
const hoisted = vi.hoisted(() => {
  const state = {
    selfHosted: false,
    platformClientId: 'platform-client' as string | null,
    tables: { microsoft_profiles: [] as any[], microsoft_profile_consumer_bindings: [] as any[] },
  };
  function builder(name: 'microsoft_profiles' | 'microsoft_profile_consumer_bindings') {
    let filters: Array<(row: any) => boolean> = [];
    const rows = () => state.tables[name].filter((row) => filters.every((f) => f(row)));
    const b: any = {
      where(cond: Record<string, unknown>) {
        filters.push((row) => Object.entries(cond).every(([k, v]) => row[k] === v));
        return b;
      },
      whereNotNull(col: string) {
        filters.push((row) => row[col] != null);
        return b;
      },
      orderBy() { return b; },
      forUpdate() { return b; },
      select() { return b; },
      first: async () => rows()[0],
      update: async (patch: Record<string, unknown>) => {
        const target = rows();
        target.forEach((row) => Object.assign(row, patch));
        return target.length;
      },
      insert(row: any) {
        let ignoreConflict = false;
        const doInsert = () => {
          const exists = state.tables[name].some((r) => r.tenant === row.tenant && r.consumer_type === row.consumer_type);
          if (exists) {
            if (ignoreConflict) return [];
            throw new Error('duplicate key');
          }
          state.tables[name].push({ ...row });
          return [{ consumer_type: row.consumer_type }];
        };
        const chain: any = {
          onConflict() { return chain; },
          ignore() { ignoreConflict = true; return chain; },
          returning: async () => doInsert(),
          then: (res: any, rej: any) => Promise.resolve().then(doInsert).then(res, rej),
        };
        return chain;
      },
      then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
    };
    return b;
  }
  return { state, builder };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({
    knex: { transaction: async (cb: (trx: unknown) => Promise<unknown>) => cb({}) },
  }),
  tenantDb: () => ({ table: (name: any) => hoisted.builder(name) }),
}));
vi.mock('@alga-psa/licensing', () => ({ isSelfHostLicensing: async () => hoisted.state.selfHosted }));
// The platform client id now lives in shared and is read from the app secrets.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async (name: string) => {
      if (!hoisted.state.platformClientId) return null;
      if (name === 'MICROSOFT_CLIENT_ID') return hoisted.state.platformClientId;
      if (name === 'MICROSOFT_CLIENT_SECRET') return 'platform-secret';
      return null;
    },
  }),
}));

import { writeMicrosoftEmailAdminConsent } from './microsoftEmailAdminConsent';
import {
  getMicrosoftPlatformAppServedConsumers,
  isMicrosoftPlatformAppOffered,
  reconcileMicrosoftPlatformAppProfile,
} from '@alga-psa/shared/services/email/microsoftPlatformApp';

const TENANT = 'tenant-1';

function profile(over: Record<string, unknown> = {}) {
  return {
    tenant: TENANT,
    profile_id: 'p1',
    client_id: 'tenant-own-client',
    capabilities: JSON.stringify(['email']),
    is_archived: false,
    email_admin_consent_granted_at: null,
    email_admin_consent_tenant_id: null,
    created_at: new Date(0),
    ...over,
  };
}

describe('supplied Microsoft app served consumers', () => {
  const original = { ee: process.env.EDITION, pub: process.env.NEXT_PUBLIC_EDITION };
  beforeEach(() => {
    hoisted.state.selfHosted = false;
    hoisted.state.platformClientId = 'platform-client';
    hoisted.state.tables.microsoft_profiles = [];
    hoisted.state.tables.microsoft_profile_consumer_bindings = [];
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  });

  it('defines email always and calendar only where calendar is visible (EE)', () => {
    expect(getMicrosoftPlatformAppServedConsumers(['msp_sso', 'email'])).toEqual(['email']);
    expect(getMicrosoftPlatformAppServedConsumers(['msp_sso', 'email', 'calendar', 'teams'])).toEqual(['email', 'calendar']);
    process.env.EDITION = original.ee ?? '';
    process.env.NEXT_PUBLIC_EDITION = 'community';
    expect(getMicrosoftPlatformAppServedConsumers()).toEqual(['email']);
  });

  it('T005: consent for a tenant-owned email profile binds only email, as before', async () => {
    hoisted.state.tables.microsoft_profiles = [profile()];
    await writeMicrosoftEmailAdminConsent({ algaTenant: TENANT, clientId: 'tenant-own-client', profileId: 'p1', actorUserId: 'u1' });
    expect(hoisted.state.tables.microsoft_profile_consumer_bindings.map((b) => [b.consumer_type, b.profile_id])).toEqual([['email', 'p1']]);
    expect(JSON.parse(hoisted.state.tables.microsoft_profiles[0].capabilities)).toEqual(['email']);
    expect(hoisted.state.tables.microsoft_profiles[0].email_admin_consent_granted_at).toBeInstanceOf(Date);
  });

  it('consent for the platform profile also binds calendar when none is bound, never replacing another binding', async () => {
    hoisted.state.tables.microsoft_profiles = [profile({ client_id: 'platform-client' })];
    await writeMicrosoftEmailAdminConsent({ algaTenant: TENANT, clientId: 'platform-client', profileId: 'p1', actorUserId: null });
    expect(hoisted.state.tables.microsoft_profile_consumer_bindings.map((b) => b.consumer_type).sort()).toEqual(['calendar', 'email']);

    hoisted.state.tables.microsoft_profiles = [profile({ client_id: 'platform-client' })];
    hoisted.state.tables.microsoft_profile_consumer_bindings = [
      { tenant: TENANT, consumer_type: 'calendar', profile_id: 'other' },
    ];
    await writeMicrosoftEmailAdminConsent({ algaTenant: TENANT, clientId: 'platform-client', profileId: 'p1', actorUserId: null });
    const calendar = hoisted.state.tables.microsoft_profile_consumer_bindings.find((b) => b.consumer_type === 'calendar');
    expect(calendar?.profile_id).toBe('other');
  });

  it('T006: with the supplied app not offered (self-hosted) reconcile is a no-op and offered is false', async () => {
    hoisted.state.selfHosted = true;
    hoisted.state.tables.microsoft_profiles = [profile({ client_id: 'platform-client', email_admin_consent_granted_at: new Date() })];
    hoisted.state.tables.microsoft_profile_consumer_bindings = [{ tenant: TENANT, consumer_type: 'email', profile_id: 'p1' }];
    expect(await isMicrosoftPlatformAppOffered()).toBe(false);
    expect((await reconcileMicrosoftPlatformAppProfile(TENANT)).changed).toBe(false);
    expect(hoisted.state.tables.microsoft_profile_consumer_bindings).toHaveLength(1);

    hoisted.state.selfHosted = false;
    hoisted.state.platformClientId = null;
    expect(await isMicrosoftPlatformAppOffered()).toBe(false);
    expect((await reconcileMicrosoftPlatformAppProfile(TENANT)).changed).toBe(false);

    hoisted.state.platformClientId = 'platform-client';
    expect(await isMicrosoftPlatformAppOffered()).toBe(true);
    const result = await reconcileMicrosoftPlatformAppProfile(TENANT);
    expect(result).toMatchObject({ changed: true, addedBindings: ['calendar'], addedCapabilities: ['calendar'] });
  });
});
