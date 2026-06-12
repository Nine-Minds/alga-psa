import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock integrations module before importing the module under test
const getStoredQboCredentialsMapMock = vi.hoisted(() => vi.fn(async () => ({})));
const getDefaultQboRealmIdMock = vi.hoisted(() => vi.fn(async () => null as string | null));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: getStoredQboCredentialsMapMock,
  getDefaultQboRealmId: getDefaultQboRealmIdMock
}));

import { resolveDefaultRealm, getAccountingSyncSettings, updateAccountingSyncSettings } from './accountingSyncSettings';
import { Knex } from 'knex';

function makeKnex(overrides: Partial<Record<string, unknown>> = {}): Knex {
  const settingsRow = {
    settings: {
      accountingSync: {
        autoSyncEnabled: false,
        autoSyncStartDate: null,
        depositAccountRef: null,
        defaultClassRef: null,
        defaultDepartmentRef: null,
        defaultRealm: null,
        ...overrides
      }
    }
  };
  const knexMock: any = {
    fn: { now: () => 'NOW()' }
  };
  knexMock.fn = { now: () => 'NOW()' };
  const chain: any = {
    where: () => chain,
    select: () => chain,
    update: async () => 1,
    insert: async () => [1],
    first: async () => settingsRow
  };
  const knexFn = (table: string) => chain;
  Object.assign(knexFn, knexMock);
  return knexFn as unknown as Knex;
}

describe('resolveDefaultRealm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the configured defaultRealm when it exists in the credentials map', async () => {
    const knex = makeKnex({ defaultRealm: 'realm-configured' });
    getStoredQboCredentialsMapMock.mockResolvedValue({
      'realm-configured': { realmId: 'realm-configured', accessToken: 'at', refreshToken: 'rt' },
      'realm-other': { realmId: 'realm-other', accessToken: 'at2', refreshToken: 'rt2' }
    });

    const result = await resolveDefaultRealm(knex, 'tenant-1');

    expect(result).toBe('realm-configured');
    expect(getDefaultQboRealmIdMock).not.toHaveBeenCalled();
  });

  it('falls back to getDefaultQboRealmId when configured defaultRealm is not in credentials map', async () => {
    const knex = makeKnex({ defaultRealm: 'realm-stale' });
    getStoredQboCredentialsMapMock.mockResolvedValue({
      'realm-active': { realmId: 'realm-active', accessToken: 'at', refreshToken: 'rt' }
    });
    getDefaultQboRealmIdMock.mockResolvedValue('realm-active');

    const result = await resolveDefaultRealm(knex, 'tenant-1');

    expect(result).toBe('realm-active');
    expect(getDefaultQboRealmIdMock).toHaveBeenCalled();
  });

  it('falls back to getDefaultQboRealmId when no defaultRealm is configured', async () => {
    const knex = makeKnex({ defaultRealm: null });
    getStoredQboCredentialsMapMock.mockResolvedValue({});
    getDefaultQboRealmIdMock.mockResolvedValue('realm-first');

    const result = await resolveDefaultRealm(knex, 'tenant-1');

    expect(result).toBe('realm-first');
    expect(getDefaultQboRealmIdMock).toHaveBeenCalled();
  });
});

describe('accountingSyncSettings normalization', () => {
  it('normalizes new fields from raw storage correctly', async () => {
    const knex = makeKnex({
      depositAccountRef: { value: 'acct-1', name: 'Checking' },
      defaultClassRef: { value: 'cls-1', name: 'Managed Services' },
      defaultDepartmentRef: { value: 'dept-1', name: 'East' },
      defaultRealm: 'realm-abc'
    });

    const settings = await getAccountingSyncSettings(knex, 'tenant-1');

    expect(settings.depositAccountRef).toEqual({ value: 'acct-1', name: 'Checking' });
    expect(settings.defaultClassRef).toEqual({ value: 'cls-1', name: 'Managed Services' });
    expect(settings.defaultDepartmentRef).toEqual({ value: 'dept-1', name: 'East' });
    expect(settings.defaultRealm).toBe('realm-abc');
  });

  it('returns null for missing new fields (backwards compatibility)', async () => {
    // Old-format settings without new fields
    const knexMock: any = {
      fn: { now: () => 'NOW()' }
    };
    const chain: any = {
      where: () => chain,
      select: () => chain,
      update: async () => 1,
      insert: async () => [1],
      first: async () => ({
        settings: {
          accountingSync: {
            autoSyncEnabled: true,
            autoSyncStartDate: '2024-01-01'
            // no depositAccountRef, defaultClassRef, etc.
          }
        }
      })
    };
    const knexFn = (table: string) => chain;
    Object.assign(knexFn, knexMock);

    const settings = await getAccountingSyncSettings(knexFn as unknown as Knex, 'tenant-1');

    expect(settings.depositAccountRef).toBeNull();
    expect(settings.defaultClassRef).toBeNull();
    expect(settings.defaultDepartmentRef).toBeNull();
    expect(settings.defaultRealm).toBeNull();
    expect(settings.autoSyncEnabled).toBe(true);
  });
});
