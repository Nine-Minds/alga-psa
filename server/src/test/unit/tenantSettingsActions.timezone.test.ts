import { beforeEach, describe, expect, it, vi } from 'vitest';

let tenantSettingsRow: any = null;

const knexWhereMock = vi.fn();
const knexSelectMock = vi.fn();
const knexInsertMock = vi.fn();
const knexOnConflictMock = vi.fn();
const knexMergeMock = vi.fn();
const createTenantKnexMock = vi.fn();

vi.mock('next/headers.js', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: 'tenant-test', roles: [] }, { tenant: 'tenant-test' }, ...args),
  withOptionalAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: 'tenant-test', roles: [] }, { tenant: 'tenant-test' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getTenantContext: () => null,
  createTenantKnex: createTenantKnexMock,
  withTransaction: (knex: any, fn: any) => fn(knex),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any) => q,
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock('@alga-psa/core/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/server')>();
  return { ...actual, featureFlags: { isEnabled: vi.fn() } };
});

const loadAction = async () =>
  (await import('../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'))
    .setTenantTimezone;

const savedSettings = () => JSON.parse(knexInsertMock.mock.calls[0][0].settings);

describe('tenantSettingsActions.setTenantTimezone', () => {
  beforeEach(() => {
    tenantSettingsRow = { settings: { other: 'kept' } };
    [knexWhereMock, knexSelectMock, knexInsertMock, knexOnConflictMock, knexMergeMock, createTenantKnexMock]
      .forEach((m) => m.mockReset());

    knexWhereMock.mockImplementation(() => ({
      select: knexSelectMock,
      first: vi.fn(async () => tenantSettingsRow),
      insert: knexInsertMock,
    }));
    knexSelectMock.mockImplementation(() => ({ first: vi.fn(async () => tenantSettingsRow) }));
    knexInsertMock.mockImplementation(() => ({ onConflict: knexOnConflictMock }));
    knexOnConflictMock.mockImplementation(() => ({ merge: knexMergeMock }));
    knexMergeMock.mockResolvedValue(undefined);
    createTenantKnexMock.mockImplementation(async () => ({
      knex: vi.fn(() => ({ where: knexWhereMock })),
    }));
  });

  it.each(['EST', 'Etc/GMT+5', 'US/Eastern'])('rejects %s with the non-location message key', async (zone) => {
    const setTenantTimezone = await loadAction();

    await expect(setTenantTimezone(zone)).resolves.toMatchObject({
      messageKey: 'msp/settings:errors.tenantSettings.nonLocationTimezone',
      messageParams: { timezone: zone },
    });
    expect(knexInsertMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown zone with the existing invalid-timezone key', async () => {
    const setTenantTimezone = await loadAction();

    await expect(setTenantTimezone('Not/AZone')).resolves.toMatchObject({
      actionError: 'Invalid timezone: Not/AZone',
      messageKey: 'msp/settings:errors.tenantSettings.invalidTimezone',
    });
    expect(knexInsertMock).not.toHaveBeenCalled();
  });

  it('rejects an empty value rather than clearing the tenant default', async () => {
    const setTenantTimezone = await loadAction();

    await expect(setTenantTimezone('  ')).resolves.toMatchObject({
      messageKey: 'msp/settings:errors.tenantSettings.invalidTimezone',
    });
    expect(knexInsertMock).not.toHaveBeenCalled();
  });

  it('saves a city zone unchanged and keeps other settings', async () => {
    const setTenantTimezone = await loadAction();

    await expect(setTenantTimezone('America/New_York')).resolves.toBeUndefined();
    expect(savedSettings()).toEqual({ other: 'kept', timezone: 'America/New_York' });
  });

  it('saves Etc/UTC as UTC', async () => {
    const setTenantTimezone = await loadAction();

    await expect(setTenantTimezone('Etc/UTC')).resolves.toBeUndefined();
    expect(savedSettings().timezone).toBe('UTC');
  });
});
