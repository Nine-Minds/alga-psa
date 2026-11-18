import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared client-creation seam: currency precedence, the prerequisites every
 * client needs, the AlgaDesk tax skip, and the rule that a tax failure must
 * reach the caller so its transaction rolls the client back.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  ensureClientDefaultBillingProfile: vi.fn(async () => 'profile-1'),
  ensureDefaultContractForClientIfBillingConfigured: vi.fn(async () => ({ ensured: false })),
  initializeClientDefaultTax: vi.fn(async () => ({}) as any),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (tableName: string) => conn(tableName) }),
}));

// clientCreation.ts imports tenantDb from this subpath, not the barrel above,
// to dodge a turbopack shim — mock it the same way or it falls through to the
// real tenantDb, which calls `.where(...)` on the fake trx's bare table
// helpers above and throws "conn(...).where is not a function".
vi.mock('@alga-psa/db/tenantDb', () => ({
  tenantDb: (conn: any) => ({ table: (tableName: string) => conn(tableName) }),
}));

vi.mock('../../billingClients/billingProfiles', () => ({
  ensureClientDefaultBillingProfile: h.ensureClientDefaultBillingProfile,
}));

vi.mock('../../billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: h.ensureDefaultContractForClientIfBillingConfigured,
}));

vi.mock('../../billingClients/defaultTaxRate', () => ({
  initializeClientDefaultTax: h.initializeClientDefaultTax,
}));

const { createClientWithDefaults } = await import('../clientCreation');

const TENANT = 'a0000000-0000-4000-8000-00000000000a';

interface FakeTrx {
  (tableName: string): any;
  inserted: Row | undefined;
}

/**
 * Minimal builder: `default_billing_settings` and `tenants` answer reads from
 * the supplied rows, `clients` records the insert and echoes it back the way
 * `returning('*')` does.
 */
function makeTrx(options: {
  billingSettings?: Row | undefined;
  tenantRow?: Row | undefined;
} = {}): FakeTrx {
  const trx = ((tableName: string) => {
    if (tableName === 'default_billing_settings') {
      return {
        select: () => ({ first: async () => options.billingSettings }),
      };
    }
    if (tableName === 'tenants') {
      return { first: async () => options.tenantRow };
    }
    if (tableName === 'clients') {
      return {
        insert: (row: Row) => {
          trx.inserted = row;
          return {
            returning: async () => [{ client_id: 'client-1', ...row }],
          };
        },
      };
    }
    throw new Error(`Unexpected table ${tableName}`);
  }) as FakeTrx;
  return trx;
}

describe('createClientWithDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.ensureClientDefaultBillingProfile.mockResolvedValue('profile-1');
    h.ensureDefaultContractForClientIfBillingConfigured.mockResolvedValue({ ensured: false } as any);
    h.initializeClientDefaultTax.mockResolvedValue({} as any);
  });

  describe('default currency precedence', () => {
    it('keeps an explicit currency over every default', async () => {
      const trx = makeTrx({ billingSettings: { default_currency_code: 'EUR' } });

      await createClientWithDefaults(trx as any, TENANT, {
        client_name: 'Acme',
        default_currency_code: 'CAD',
      }, { defaultCurrencyCode: 'GBP' });

      expect(trx.inserted?.default_currency_code).toBe('CAD');
    });

    it('prefers the caller-supplied option over a fresh settings lookup', async () => {
      const trx = makeTrx({ billingSettings: { default_currency_code: 'EUR' } });

      await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' }, {
        defaultCurrencyCode: 'GBP',
      });

      expect(trx.inserted?.default_currency_code).toBe('GBP');
    });

    it("adopts the tenant's configured default when the caller supplies none", async () => {
      const trx = makeTrx({ billingSettings: { default_currency_code: 'EUR' } });

      await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' });

      expect(trx.inserted?.default_currency_code).toBe('EUR');
    });

    it("falls back to 'USD' when the tenant has no billing settings", async () => {
      const trx = makeTrx({ billingSettings: undefined });

      await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' });

      expect(trx.inserted?.default_currency_code).toBe('USD');
    });
  });

  it('provisions the billing profile, default contract and tax settings', async () => {
    const trx = makeTrx();

    const created = await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' });

    expect(created.client_id).toBe('client-1');
    expect(h.ensureClientDefaultBillingProfile).toHaveBeenCalledWith(trx, TENANT, 'client-1', {
      clientName: 'Acme',
    });
    expect(h.ensureDefaultContractForClientIfBillingConfigured).toHaveBeenCalledWith(trx, {
      tenant: TENANT,
      clientId: 'client-1',
    });
    expect(h.initializeClientDefaultTax).toHaveBeenCalledWith(trx, TENANT, 'client-1');
  });

  it('stamps tenant, timestamps and an active default', async () => {
    const trx = makeTrx();

    await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' });

    expect(trx.inserted?.tenant).toBe(TENANT);
    expect(trx.inserted?.is_inactive).toBe(false);
    expect(typeof trx.inserted?.created_at).toBe('string');
    expect(typeof trx.inserted?.updated_at).toBe('string');
    // lifecycle_status is left to the column default.
    expect(trx.inserted).not.toHaveProperty('lifecycle_status');
  });

  it('keeps properties a plain object so node-postgres serializes the jsonb', async () => {
    const trx = makeTrx();

    await createClientWithDefaults(trx as any, TENANT, {
      client_name: 'Acme',
      properties: { industry: 'mining' },
      url: 'https://acme.test',
    });

    expect(trx.inserted?.properties).toEqual({ industry: 'mining', website: 'https://acme.test' });
  });

  describe('website/url sync', () => {
    it('fills url from properties.website', async () => {
      const trx = makeTrx();

      await createClientWithDefaults(trx as any, TENANT, {
        client_name: 'Acme',
        properties: { website: 'https://acme.test' },
      });

      expect(trx.inserted?.url).toBe('https://acme.test');
    });

    it('fills properties.website from url', async () => {
      const trx = makeTrx();

      await createClientWithDefaults(trx as any, TENANT, {
        client_name: 'Acme',
        url: 'https://acme.test',
      });

      expect(trx.inserted?.properties).toEqual({ website: 'https://acme.test' });
    });
  });

  describe('tax initialization', () => {
    it('skips tax for AlgaDesk tenants, which have no billing tax setup', async () => {
      const trx = makeTrx({ tenantRow: { product_code: 'algadesk' } });

      await createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' });

      expect(h.initializeClientDefaultTax).not.toHaveBeenCalled();
      // The rest of the prerequisites still run.
      expect(h.ensureClientDefaultBillingProfile).toHaveBeenCalled();
    });

    it('skips tax — and the product lookup — when the caller opts out', async () => {
      const trx = makeTrx();
      const tableSpy = vi.fn(trx);

      await createClientWithDefaults(tableSpy as any, TENANT, { client_name: 'Acme' }, {
        skipTaxSettings: true,
      });

      expect(h.initializeClientDefaultTax).not.toHaveBeenCalled();
      expect(tableSpy).not.toHaveBeenCalledWith('tenants');
    });

    it('trusts an explicit opt-in without re-reading the product code', async () => {
      // A batch caller resolved the product code once; the seam must not pay
      // for a `tenants` read per row.
      const trx = makeTrx();
      const tableSpy = vi.fn(trx);

      await createClientWithDefaults(tableSpy as any, TENANT, { client_name: 'Acme' }, {
        skipTaxSettings: false,
      });

      expect(h.initializeClientDefaultTax).toHaveBeenCalledWith(tableSpy, TENANT, 'client-1');
      expect(tableSpy).not.toHaveBeenCalledWith('tenants');
    });

    it('propagates a tax failure so the caller transaction rolls the client back', async () => {
      const trx = makeTrx();
      h.initializeClientDefaultTax.mockRejectedValueOnce(
        new Error('configured default tax rate is invalid') as never
      );

      await expect(
        createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' })
      ).rejects.toThrow('configured default tax rate is invalid');
    });
  });

  it('fails loudly when the insert returns no row', async () => {
    const trx = ((tableName: string) => {
      if (tableName === 'default_billing_settings') {
        return { select: () => ({ first: async () => undefined }) };
      }
      if (tableName === 'clients') {
        return { insert: () => ({ returning: async () => [] }) };
      }
      throw new Error(`Unexpected table ${tableName}`);
    }) as unknown as FakeTrx;

    await expect(
      createClientWithDefaults(trx as any, TENANT, { client_name: 'Acme' })
    ).rejects.toThrow('Client insert completed without returning the created record.');
  });
});
