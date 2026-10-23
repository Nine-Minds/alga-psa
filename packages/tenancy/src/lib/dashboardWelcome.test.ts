import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantDbMock = vi.hoisted(() => vi.fn());
const tenantJoinMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  tenantDb: tenantDbMock,
}));

interface FakeState {
  tenantSettings: Record<string, unknown> | undefined;
  tenantCompanies: Array<{ client_name: string | null; is_default: boolean; deleted_at: null }>;
}

let state: FakeState;

/** Knex builders are thenable, and the join is attached after `.first()`. */
function builderFor(table: string) {
  let criteria: Record<string, unknown> = {};

  const builder: any = {
    where(next: Record<string, unknown>) {
      criteria = next;
      return builder;
    },
    select() {
      return builder;
    },
    first() {
      return builder;
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(rowFor(table, criteria)).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

function rowFor(table: string, criteria: Record<string, unknown>) {
  if (table === 'tenant_settings') {
    return state.tenantSettings;
  }

  if (table === 'tenant_companies') {
    const wantsDefault = criteria['tenant_companies.is_default'] === true;
    const row = state.tenantCompanies.find(
      (company) => (!wantsDefault || company.is_default) && company.deleted_at === null
    );
    return row ? { client_name: row.client_name } : undefined;
  }

  throw new Error(`Unexpected table ${table}`);
}

const conn = {} as any;

async function load() {
  return import('./dashboardWelcome');
}

async function loadCompanyName() {
  return import('./tenantDefaultCompanyName');
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    tenantSettings: { settings: { dashboardWelcome: { useCompanyName: true } } },
    tenantCompanies: [{ client_name: 'Nine Minds', is_default: true, deleted_at: null }],
  };
  tenantDbMock.mockImplementation((_conn: unknown, tenant: string) => ({
    tenant,
    table: (table: string) => builderFor(table),
    tenantJoin: tenantJoinMock,
  }));
});

describe('normalizeDashboardWelcomeFlag', () => {
  it('is true only for an explicit boolean true', async () => {
    const { normalizeDashboardWelcomeFlag } = await load();

    expect(normalizeDashboardWelcomeFlag({ useCompanyName: true })).toBe(true);
    expect(normalizeDashboardWelcomeFlag({ useCompanyName: 'true' })).toBe(false);
    expect(normalizeDashboardWelcomeFlag({ useCompanyName: 1 })).toBe(false);
    expect(normalizeDashboardWelcomeFlag({})).toBe(false);
    expect(normalizeDashboardWelcomeFlag(undefined)).toBe(false);
    expect(normalizeDashboardWelcomeFlag(null)).toBe(false);
    expect(normalizeDashboardWelcomeFlag('dashboardWelcome')).toBe(false);
  });
});

describe('resolveTenantDefaultCompanyName', () => {
  it('reads the name of the client marked as the tenant default', async () => {
    const { resolveTenantDefaultCompanyName } = await loadCompanyName();

    await expect(resolveTenantDefaultCompanyName(conn, 'tenant-1')).resolves.toBe('Nine Minds');
    expect(tenantDbMock).toHaveBeenCalledWith(conn, 'tenant-1');
    expect(tenantJoinMock).toHaveBeenCalledWith(
      expect.anything(),
      'clients',
      'clients.client_id',
      'tenant_companies.client_id'
    );
  });

  it('trims the stored name', async () => {
    state.tenantCompanies = [{ client_name: '  Nine Minds  ', is_default: true, deleted_at: null }];

    const { resolveTenantDefaultCompanyName } = await loadCompanyName();
    await expect(resolveTenantDefaultCompanyName(conn, 'tenant-1')).resolves.toBe('Nine Minds');
  });

  it('returns null when no client is marked as the default', async () => {
    state.tenantCompanies = [];

    const { resolveTenantDefaultCompanyName } = await loadCompanyName();
    await expect(resolveTenantDefaultCompanyName(conn, 'tenant-1')).resolves.toBeNull();
  });

  it('returns null for a blank name rather than an empty banner', async () => {
    state.tenantCompanies = [{ client_name: '   ', is_default: true, deleted_at: null }];

    const { resolveTenantDefaultCompanyName } = await loadCompanyName();
    await expect(resolveTenantDefaultCompanyName(conn, 'tenant-1')).resolves.toBeNull();
  });
});

describe('resolveDashboardWelcome', () => {
  it('resolves the flag together with the name it would show', async () => {
    const { resolveDashboardWelcome } = await load();

    await expect(resolveDashboardWelcome(conn, 'tenant-1')).resolves.toEqual({
      useCompanyName: true,
      companyName: 'Nine Minds',
    });
  });

  it('parses a settings column handed back as a JSON string', async () => {
    state.tenantSettings = { settings: JSON.stringify({ dashboardWelcome: { useCompanyName: true } }) };

    const { resolveDashboardWelcome } = await load();
    await expect(resolveDashboardWelcome(conn, 'tenant-1')).resolves.toEqual({
      useCompanyName: true,
      companyName: 'Nine Minds',
    });
  });

  it('stays opted out when the tenant has no settings row at all', async () => {
    state.tenantSettings = undefined;

    const { resolveDashboardWelcome } = await load();
    await expect(resolveDashboardWelcome(conn, 'tenant-1')).resolves.toEqual({
      useCompanyName: false,
      companyName: 'Nine Minds',
    });
  });

  it('reports the opt-in even when no default client can name it', async () => {
    state.tenantCompanies = [];

    const { resolveDashboardWelcome } = await load();
    await expect(resolveDashboardWelcome(conn, 'tenant-1')).resolves.toEqual({
      useCompanyName: true,
      companyName: null,
    });
  });
});
