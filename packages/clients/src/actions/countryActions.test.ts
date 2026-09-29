import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn((conn: any) => ({
  table: (table: string) => conn(table),
})));

type ServerAction = (...args: unknown[]) => unknown;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: tenantDbMock,
}));

interface FakeState {
  tenant_companies: Record<string, any>[];
  client_locations: Record<string, any>[];
  countries: Record<string, any>[];
}

let state: FakeState;

function fakeConn(table: keyof FakeState) {
  if (!state[table]) {
    throw new Error(`Unexpected table ${table}`);
  }

  return {
    where(criteria: Record<string, any>) {
      const matched = state[table].filter((row) =>
        Object.entries(criteria).every(([column, value]) => (row[column] ?? null) === value)
      );

      const builder = {
        // Every ordered column in this action is a boolean flag.
        orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
          matched.sort((left, right) => {
            const a = Number(Boolean(left[column]));
            const b = Number(Boolean(right[column]));
            return direction === 'desc' ? b - a : a - b;
          });
          return builder;
        },
        first: async (...columns: string[]) => {
          const row = matched[0];
          if (!row) return undefined;
          return columns.length === 0
            ? { ...row }
            : Object.fromEntries(columns.map((column) => [column, row[column]]));
        },
      };

      return builder;
    },
  };
}

async function getTenantDefaultCountry() {
  const { getTenantDefaultCountry: action } = await import('./countryActions');
  return action() as Promise<{ code: string; name: string } | null>;
}

describe('getTenantDefaultCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      tenant_companies: [{ client_id: 'msp-client', is_default: true, deleted_at: null }],
      client_locations: [
        {
          client_id: 'msp-client',
          country_code: 'GB',
          is_default: true,
          is_billing_address: true,
          is_active: true,
        },
      ],
      countries: [
        { code: 'US', name: 'United States', is_active: true },
        { code: 'GB', name: 'United Kingdom', is_active: true },
      ],
    };
    createTenantKnexMock.mockResolvedValue({
      knex: (table: keyof FakeState) => fakeConn(table),
      tenant: 'tenant-1',
    });
  });

  it('resolves the country on the MSP default client location against the reference table', async () => {
    await expect(getTenantDefaultCountry()).resolves.toEqual({ code: 'GB', name: 'United Kingdom' });
  });

  it('prefers the default location over the tenant client other active locations', async () => {
    state.client_locations.unshift({
      client_id: 'msp-client',
      country_code: 'US',
      is_default: false,
      is_billing_address: false,
      is_active: true,
    });

    await expect(getTenantDefaultCountry()).resolves.toEqual({ code: 'GB', name: 'United Kingdom' });
  });

  it('normalizes a lowercase stored code', async () => {
    state.client_locations[0].country_code = 'gb';

    await expect(getTenantDefaultCountry()).resolves.toEqual({ code: 'GB', name: 'United Kingdom' });
  });

  it("returns null for the 'XX' placeholder rather than preselecting a country", async () => {
    state.client_locations[0].country_code = 'XX';

    await expect(getTenantDefaultCountry()).resolves.toBeNull();
  });

  it('returns null when the stored code is missing', async () => {
    state.client_locations[0].country_code = null;

    await expect(getTenantDefaultCountry()).resolves.toBeNull();
  });

  it('returns null when the stored code is not in the reference table', async () => {
    state.client_locations[0].country_code = 'ZZ';

    await expect(getTenantDefaultCountry()).resolves.toBeNull();
  });

  it('returns null when the tenant has no default client', async () => {
    state.tenant_companies = [];

    await expect(getTenantDefaultCountry()).resolves.toBeNull();
  });

  it('returns null when the tenant default client has no location', async () => {
    state.client_locations = [];

    await expect(getTenantDefaultCountry()).resolves.toBeNull();
  });
});
