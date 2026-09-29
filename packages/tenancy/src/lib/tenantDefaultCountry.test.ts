import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantDbMock = vi.hoisted(() => vi.fn((conn: any) => ({
  table: (table: string) => conn(table),
})));

vi.mock('@alga-psa/db', () => ({
  tenantDb: tenantDbMock,
}));

interface FakeState {
  tenant_companies: Record<string, any>[];
  client_locations: Record<string, any>[];
  countries: Record<string, any>[];
  users: Record<string, any>[];
  contacts: Record<string, any>[];
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
        // Every ordered column in this resolver is a boolean flag.
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

const conn = ((table: keyof FakeState) => fakeConn(table)) as any;

async function load() {
  return import('./tenantDefaultCountry');
}

function location(clientId: string, countryCode: string | null, isDefault = true) {
  return {
    client_id: clientId,
    country_code: countryCode,
    is_default: isDefault,
    is_billing_address: isDefault,
    is_active: true,
  };
}

describe('resolveClientCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      tenant_companies: [{ client_id: 'msp-client', is_default: true, deleted_at: null }],
      client_locations: [location('msp-client', 'US'), location('acme', 'GB')],
      countries: [
        { code: 'US', name: 'United States', is_active: true },
        { code: 'GB', name: 'United Kingdom', is_active: true },
      ],
      users: [],
      contacts: [],
    };
  });

  it("resolves a client's own location country", async () => {
    const { resolveClientCountry } = await load();
    await expect(resolveClientCountry(conn, 'tenant-1', 'acme')).resolves.toEqual({
      code: 'GB',
      name: 'United Kingdom',
    });
  });

  it('prefers the default location over other active ones', async () => {
    state.client_locations.unshift(location('acme', 'US', false));

    const { resolveClientCountry } = await load();
    await expect(resolveClientCountry(conn, 'tenant-1', 'acme')).resolves.toEqual({
      code: 'GB',
      name: 'United Kingdom',
    });
  });

  it("returns null for the 'XX' placeholder and for codes outside the reference table", async () => {
    const { resolveClientCountry } = await load();

    state.client_locations = [location('acme', 'XX')];
    await expect(resolveClientCountry(conn, 'tenant-1', 'acme')).resolves.toBeNull();

    state.client_locations = [location('acme', 'ZZ')];
    await expect(resolveClientCountry(conn, 'tenant-1', 'acme')).resolves.toBeNull();
  });

  it('returns null without querying when no client is supplied', async () => {
    const { resolveClientCountry } = await load();
    await expect(resolveClientCountry(conn, 'tenant-1', '')).resolves.toBeNull();
  });
});

describe('resolveDateFormatCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      tenant_companies: [{ client_id: 'msp-client', is_default: true, deleted_at: null }],
      client_locations: [location('msp-client', 'US'), location('acme', 'GB')],
      countries: [
        { code: 'US', name: 'United States', is_active: true },
        { code: 'GB', name: 'United Kingdom', is_active: true },
      ],
      users: [
        { user_id: 'staff-1', contact_id: null },
        { user_id: 'portal-1', contact_id: 'contact-1' },
        { user_id: 'portal-orphan', contact_id: null },
      ],
      contacts: [{ contact_name_id: 'contact-1', client_id: 'acme' }],
    };
  });

  it('gives MSP staff the tenant default country, never a client one', async () => {
    const { resolveDateFormatCountry } = await load();
    await expect(
      resolveDateFormatCountry(conn, 'tenant-1', { user_id: 'staff-1', user_type: 'internal' })
    ).resolves.toEqual({ code: 'US', name: 'United States' });
  });

  it("gives a portal user their own client's country", async () => {
    const { resolveDateFormatCountry } = await load();
    await expect(
      resolveDateFormatCountry(conn, 'tenant-1', { user_id: 'portal-1', user_type: 'client' })
    ).resolves.toEqual({ code: 'GB', name: 'United Kingdom' });
  });

  it("falls back to the tenant default when the portal user's client has no usable country", async () => {
    state.client_locations = [location('msp-client', 'US'), location('acme', 'XX')];

    const { resolveDateFormatCountry } = await load();
    await expect(
      resolveDateFormatCountry(conn, 'tenant-1', { user_id: 'portal-1', user_type: 'client' })
    ).resolves.toEqual({ code: 'US', name: 'United States' });
  });

  it('falls back to the tenant default when the portal user has no contact', async () => {
    const { resolveDateFormatCountry } = await load();
    await expect(
      resolveDateFormatCountry(conn, 'tenant-1', { user_id: 'portal-orphan', user_type: 'client' })
    ).resolves.toEqual({ code: 'US', name: 'United States' });
  });

  it('returns null when neither the client nor the tenant has a country', async () => {
    state.client_locations = [location('msp-client', 'XX'), location('acme', 'XX')];

    const { resolveDateFormatCountry } = await load();
    await expect(
      resolveDateFormatCountry(conn, 'tenant-1', { user_id: 'portal-1', user_type: 'client' })
    ).resolves.toBeNull();
  });
});
