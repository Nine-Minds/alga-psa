import { describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Tests the real locale-hierarchy resolution logic (user preference ->
 * client default -> portal default -> org default -> system default) with a
 * mocked connection layer. The auth wrapper is replaced with an identity
 * function so the inner handlers can be driven directly with (user, ctx).
 * All fixture lookups honor the tenant filters issued by the product code,
 * so a missing tenant constraint would surface as a cross-tenant leak.
 */

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
}));

const fixtureState = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => {
    const knex = (table: string) => {
      let filter: Record<string, unknown> | null = null;
      const builder = {
        where(condition: Record<string, unknown>) {
          filter = condition;
          return builder;
        },
        async first() {
          const rows = fixtureState.tables[table] ?? [];
          return rows.find((row) =>
            Object.entries(filter ?? {}).every(([key, value]) => row[key] === value)
          );
        },
      };
      return builder;
    };
    return knex;
  }),
}));

import { getHierarchicalLocaleAction } from '../actions/locale-actions/getHierarchicalLocale';
import { getInheritedLocaleAction } from '../actions/locale-actions/getInheritedLocale';

type LocaleHandler = (
  user: Partial<IUserWithRoles> | null,
  ctx: { tenant: string } | null
) => Promise<unknown>;

const getHierarchicalLocale = getHierarchicalLocaleAction as unknown as LocaleHandler;
const getInheritedLocale = getInheritedLocaleAction as unknown as LocaleHandler;

const TENANT = 'tenant-a';

function internalUser(): Partial<IUserWithRoles> {
  return { user_id: 'user-1', user_type: 'internal' };
}

function clientUser(): Partial<IUserWithRoles> {
  return { user_id: 'user-2', user_type: 'client', contact_id: 'contact-1' };
}

function setFixtures(tables: Record<string, Array<Record<string, unknown>>>) {
  fixtureState.tables = tables;
}

function clientChainFixtures(clientProperties: Record<string, unknown> | null) {
  return {
    users: [{ user_id: 'user-2', tenant: TENANT, contact_id: 'contact-1' }],
    contacts: [{ contact_name_id: 'contact-1', tenant: TENANT, client_id: 'client-1' }],
    clients: [{ client_id: 'client-1', tenant: TENANT, properties: clientProperties }],
  };
}

describe('getHierarchicalLocaleAction', () => {
  it('returns the system default when unauthenticated', async () => {
    setFixtures({});
    await expect(getHierarchicalLocale(null, null)).resolves.toBe('en');
  });

  it('prefers the user preference and strips JSON quoting', async () => {
    setFixtures({
      user_preferences: [
        { user_id: 'user-1', setting_name: 'locale', tenant: TENANT, setting_value: '"fr"' },
      ],
    });

    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('fr');
  });

  it('ignores unsupported user preferences and falls through to the org default', async () => {
    setFixtures({
      user_preferences: [
        { user_id: 'user-1', setting_name: 'locale', tenant: TENANT, setting_value: 'zz' },
      ],
      tenant_settings: [{ tenant: TENANT, settings: { defaultLocale: 'it' } }],
    });

    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('it');
  });

  it('does not read a user preference stored under a different tenant', async () => {
    setFixtures({
      user_preferences: [
        { user_id: 'user-1', setting_name: 'locale', tenant: 'tenant-b', setting_value: '"fr"' },
      ],
    });

    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('en');
  });

  it('uses the client default for client-portal users', async () => {
    setFixtures({
      ...clientChainFixtures({ defaultLocale: 'de' }),
      tenant_settings: [
        { tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' }, defaultLocale: 'it' } },
      ],
    });

    await expect(getHierarchicalLocale(clientUser(), { tenant: TENANT })).resolves.toBe('de');
  });

  it('falls back to the client-portal default when the client has none', async () => {
    setFixtures({
      ...clientChainFixtures(null),
      tenant_settings: [
        { tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' }, defaultLocale: 'it' } },
      ],
    });

    await expect(getHierarchicalLocale(clientUser(), { tenant: TENANT })).resolves.toBe('es');
  });

  it('skips client-portal defaults for internal users and uses the org default', async () => {
    setFixtures({
      tenant_settings: [
        { tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' }, defaultLocale: 'it' } },
      ],
    });

    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('it');
  });

  it('consults the legacy MSP default only for internal users', async () => {
    setFixtures({
      tenant_settings: [{ tenant: TENANT, settings: { mspPortal: { defaultLocale: 'pl' } } }],
    });

    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('pl');
    await expect(getHierarchicalLocale(clientUser(), { tenant: TENANT })).resolves.toBe('en');
  });

  it('falls back to the system default when nothing is configured', async () => {
    setFixtures({});
    await expect(getHierarchicalLocale(internalUser(), { tenant: TENANT })).resolves.toBe('en');
  });
});

describe('getInheritedLocaleAction', () => {
  it('returns the system default when unauthenticated', async () => {
    setFixtures({});
    await expect(getInheritedLocale(null, null)).resolves.toEqual({ locale: 'en', source: 'system' });
  });

  it('attributes a client default to the client source', async () => {
    setFixtures({
      ...clientChainFixtures({ defaultLocale: 'nl' }),
    });

    await expect(getInheritedLocale(clientUser(), { tenant: TENANT })).resolves.toEqual({
      locale: 'nl',
      source: 'client',
    });
  });

  it('attributes the client-portal default to the tenant source for client users', async () => {
    setFixtures({
      ...clientChainFixtures(null),
      tenant_settings: [{ tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' } } }],
    });

    await expect(getInheritedLocale(clientUser(), { tenant: TENANT })).resolves.toEqual({
      locale: 'es',
      source: 'tenant',
    });
  });

  it('internal users skip the client-portal default and inherit the org default', async () => {
    setFixtures({
      tenant_settings: [
        { tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' }, defaultLocale: 'fr' } },
      ],
    });

    await expect(getInheritedLocale(internalUser(), { tenant: TENANT })).resolves.toEqual({
      locale: 'fr',
      source: 'tenant',
    });
  });

  it('internal users with only a client-portal default fall through to system', async () => {
    setFixtures({
      tenant_settings: [{ tenant: TENANT, settings: { clientPortal: { defaultLocale: 'es' } } }],
    });

    await expect(getInheritedLocale(internalUser(), { tenant: TENANT })).resolves.toEqual({
      locale: 'en',
      source: 'system',
    });
  });

  it('does not inherit tenant settings from another tenant', async () => {
    setFixtures({
      tenant_settings: [{ tenant: 'tenant-b', settings: { defaultLocale: 'fr' } }],
    });

    await expect(getInheritedLocale(internalUser(), { tenant: TENANT })).resolves.toEqual({
      locale: 'en',
      source: 'system',
    });
  });
});
