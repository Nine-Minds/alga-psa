/**
 * Tests for the email locale resolution hierarchy:
 * user preference -> client default -> client-portal default ->
 * org default (-> legacy MSP default for internal users) -> 'en'.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRow {
  __table: string;
  [key: string]: any;
}

let rows: FakeRow[] = [];

function fakeKnex(table: string) {
  return {
    where(filters: Record<string, any>) {
      return {
        async first() {
          return rows.find(
            (row) =>
              row.__table === table &&
              Object.entries(filters).every(([key, value]) => row[key] === value)
          );
        }
      };
    }
  };
}

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => fakeKnex)
}));

import { resolveEmailLocale, getTenantDefaultLocale } from '../emailLocaleResolver';

const TENANT = 'tenant-1';

describe('resolveEmailLocale', () => {
  beforeEach(() => {
    rows = [];
  });

  it('prefers the user preference when it is a supported locale', async () => {
    rows = [
      { __table: 'users', user_id: 'u1', tenant: TENANT, user_type: 'internal' },
      {
        __table: 'user_preferences',
        user_id: 'u1',
        setting_name: 'locale',
        tenant: TENANT,
        setting_value: '"fr"'
      },
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { defaultLocale: 'de' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'u1@test', userId: 'u1' })
    ).resolves.toBe('fr');
  });

  it('ignores unsupported user preferences and falls through the hierarchy', async () => {
    rows = [
      { __table: 'users', user_id: 'u1', tenant: TENANT, user_type: 'internal' },
      {
        __table: 'user_preferences',
        user_id: 'u1',
        setting_name: 'locale',
        tenant: TENANT,
        setting_value: 'tlh' // Klingon: not supported
      },
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { defaultLocale: 'de' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'u1@test', userId: 'u1' })
    ).resolves.toBe('de');
  });

  it('uses the client default locale for client-portal recipients', async () => {
    rows = [
      {
        __table: 'clients',
        client_id: 'c1',
        tenant: TENANT,
        properties: { defaultLocale: 'es' }
      },
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { clientPortal: { defaultLocale: 'nl' }, defaultLocale: 'de' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'contact@client.test', userType: 'client', clientId: 'c1' })
    ).resolves.toBe('es');
  });

  it('falls back to the client-portal default when the client has no locale', async () => {
    rows = [
      { __table: 'clients', client_id: 'c1', tenant: TENANT, properties: {} },
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { clientPortal: { defaultLocale: 'nl' }, defaultLocale: 'de' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'contact@client.test', userType: 'client', clientId: 'c1' })
    ).resolves.toBe('nl');
  });

  it('skips client and client-portal defaults for internal users and uses the org default', async () => {
    rows = [
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { clientPortal: { defaultLocale: 'nl' }, defaultLocale: 'de' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'staff@msp.test', userType: 'internal' })
    ).resolves.toBe('de');
  });

  it('resolves the client id via the user contact for client users without an explicit clientId', async () => {
    rows = [
      { __table: 'users', user_id: 'u2', tenant: TENANT, user_type: 'client', contact_id: 'ct1' },
      { __table: 'contacts', contact_name_id: 'ct1', tenant: TENANT, client_id: 'c9' },
      {
        __table: 'clients',
        client_id: 'c9',
        tenant: TENANT,
        properties: { defaultLocale: 'it' }
      }
    ];

    await expect(
      resolveEmailLocale(TENANT, { email: 'u2@test', userId: 'u2', userType: 'client' })
    ).resolves.toBe('it');
  });

  it('falls back to the system default (en) when nothing is configured', async () => {
    rows = [];

    await expect(
      resolveEmailLocale(TENANT, { email: 'nobody@test' })
    ).resolves.toBe('en');
  });
});

describe('getTenantDefaultLocale', () => {
  beforeEach(() => {
    rows = [];
  });

  it('returns the org default when configured', async () => {
    rows = [
      { __table: 'tenant_settings', tenant: TENANT, settings: { defaultLocale: 'pl' } }
    ];

    await expect(getTenantDefaultLocale(TENANT, 'client')).resolves.toBe('pl');
  });

  it('consults the legacy MSP default only for internal users', async () => {
    rows = [
      {
        __table: 'tenant_settings',
        tenant: TENANT,
        settings: { mspPortal: { defaultLocale: 'fr' } }
      }
    ];

    await expect(getTenantDefaultLocale(TENANT, 'internal')).resolves.toBe('fr');
    await expect(getTenantDefaultLocale(TENANT, 'client')).resolves.toBe('en');
  });

  it('ignores unsupported configured locales', async () => {
    rows = [
      { __table: 'tenant_settings', tenant: TENANT, settings: { defaultLocale: 'xx' } }
    ];

    await expect(getTenantDefaultLocale(TENANT)).resolves.toBe('en');
  });
});
