import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
// Mirrors tenantDb(conn, tenant) so assertions can read the tenant argument.
const tenantDbMock = vi.hoisted(() => vi.fn((conn: any, _tenant?: string | null) => ({
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
      let matched = state[table].filter((row) =>
        Object.entries(criteria).every(([column, value]) => (row[column] ?? null) === value)
      );

      const builder = {
        // The only raw predicate here is the case-insensitive country name match.
        whereRaw(sql: string, bindings: unknown[] = []) {
          if (!/lower\(name\)\s*=\s*lower\(\?\)/.test(sql)) {
            throw new Error(`Unexpected raw predicate ${sql}`);
          }
          const needle = String(bindings[0] ?? '').toLowerCase();
          matched = matched.filter((row) => String(row.name ?? '').toLowerCase() === needle);
          return builder;
        },
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

async function getClientCountryDefaultsPreview(clientId: string) {
  const { getClientCountryDefaultsPreview: action } = await import('./countryActions');
  return action(clientId) as Promise<{
    country: { code: string; name: string; phone_code?: string } | null;
    dateFormat: { country: string | null; datePattern: string; hour12: boolean };
  }>;
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

describe('getClientCountryDefaultsPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      tenant_companies: [{ client_id: 'msp-client', is_default: true, deleted_at: null }],
      client_locations: [
        {
          client_id: 'msp-client',
          country_code: 'US',
          is_default: true,
          is_billing_address: true,
          is_active: true,
        },
        {
          client_id: 'candidate',
          country_code: 'GB',
          is_default: true,
          is_billing_address: true,
          is_active: true,
        },
      ],
      countries: [
        { code: 'US', name: 'United States', phone_code: '+1', is_active: true },
        { code: 'GB', name: 'United Kingdom', phone_code: '+44', is_active: true },
      ],
    };
    createTenantKnexMock.mockResolvedValue({
      knex: (table: keyof FakeState) => fakeConn(table),
      tenant: 'tenant-1',
    });
  });

  it("answers the country, dial code and date shape of the client's own location", async () => {
    await expect(getClientCountryDefaultsPreview('candidate')).resolves.toEqual({
      country: { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
      dateFormat: expect.objectContaining({
        country: 'GB',
        datePattern: 'dd/MM/yyyy',
        hour12: false,
      }),
    });
  });

  it('scopes every read to the caller tenant', async () => {
    await getClientCountryDefaultsPreview('candidate');

    expect(tenantDbMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(tenantDbMock.mock.calls.every(([, tenant]) => tenant === 'tenant-1')).toBe(true);
  });

  it('falls back to the fixed system date format when the client has no country', async () => {
    state.client_locations = state.client_locations.filter((row) => row.client_id !== 'candidate');

    await expect(getClientCountryDefaultsPreview('candidate')).resolves.toEqual({
      country: null,
      dateFormat: expect.objectContaining({
        country: null,
        datePattern: 'MM/dd/yyyy',
        hour12: true,
      }),
    });
  });

  it('previews the country the location displays when its code is a legacy alias', async () => {
    // A location saved as 'UK'/'United Kingdom' renders as United Kingdom, so
    // the preview must not contradict it with "no country" and US dates.
    const candidate = state.client_locations.find((row) => row.client_id === 'candidate')!;
    candidate.country_code = 'UK';
    candidate.country_name = 'United Kingdom';

    await expect(getClientCountryDefaultsPreview('candidate')).resolves.toEqual({
      country: { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
      dateFormat: expect.objectContaining({
        country: 'GB',
        datePattern: 'dd/MM/yyyy',
        hour12: false,
      }),
    });
  });

  it('keeps the country when the reference row carries no dial code', async () => {
    state.countries = [{ code: 'GB', name: 'United Kingdom', is_active: true }];

    await expect(getClientCountryDefaultsPreview('candidate')).resolves.toEqual({
      country: { code: 'GB', name: 'United Kingdom', phone_code: undefined },
      dateFormat: expect.objectContaining({ country: 'GB' }),
    });
  });
});
