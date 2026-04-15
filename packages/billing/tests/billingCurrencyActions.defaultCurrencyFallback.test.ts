import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockTableState = {
  client: Record<string, unknown> | null;
  contracts: Array<Record<string, unknown>>;
  billingSettings: Record<string, unknown> | null;
};

const mockState: MockTableState = {
  client: null,
  contracts: [],
  billingSettings: null,
};

function createMockKnex(state: MockTableState) {
  return (table: string) => {
    if (table === 'clients') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(state.client),
          }),
        }),
      };
    }

    if (table === 'client_contracts as cc') {
      // Build a self-referencing chain for Knex query builder
      const chain: any = {};
      chain.join = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockImplementation((arg: unknown) => {
        if (typeof arg === 'function') arg.call(chain);
        return chain;
      });
      chain.whereNull = vi.fn().mockReturnValue(chain);
      chain.orWhere = vi.fn().mockReturnValue(chain);
      chain.whereNotNull = vi.fn().mockReturnValue(chain);
      chain.distinct = vi.fn().mockResolvedValue(state.contracts);
      return chain;
    }

    if (table === 'default_billing_settings') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(state.billingSettings),
          }),
        }),
      };
    }

    return {};
  };
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: createMockKnex(mockState) })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

describe('resolveClientBillingCurrency — fallback chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.client = null;
    mockState.contracts = [];
    mockState.billingSettings = null;
  });

  it('returns contract currency when active contracts exist', async () => {
    mockState.client = { default_currency_code: 'AUD' };
    mockState.contracts = [{ currency_code: 'GBP' }];
    mockState.billingSettings = { default_currency_code: 'EUR' };

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('GBP');
  });

  it('returns client default when no active contracts', async () => {
    mockState.client = { default_currency_code: 'AUD' };
    mockState.contracts = [];
    mockState.billingSettings = { default_currency_code: 'EUR' };

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('AUD');
  });

  it('returns tenant billing settings default when no contract or client default', async () => {
    mockState.client = { default_currency_code: null };
    mockState.contracts = [];
    mockState.billingSettings = { default_currency_code: 'EUR' };

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('EUR');
  });

  it('returns USD as final fallback when nothing is configured', async () => {
    mockState.client = { default_currency_code: null };
    mockState.contracts = [];
    mockState.billingSettings = null;

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('USD');
  });

  it('falls back to billing settings when client is not found', async () => {
    mockState.client = null;
    mockState.contracts = [];
    mockState.billingSettings = { default_currency_code: 'EUR' };

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('EUR');
  });

  it('returns contract currency even when it matches client default', async () => {
    mockState.client = { default_currency_code: 'GBP' };
    mockState.contracts = [{ currency_code: 'GBP' }];
    mockState.billingSettings = { default_currency_code: 'EUR' };

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    const result = await resolveClientBillingCurrency(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBe('GBP');
  });

  it('throws when client has contracts in multiple currencies', async () => {
    mockState.client = { default_currency_code: 'AUD' };
    mockState.contracts = [{ currency_code: 'GBP' }, { currency_code: 'EUR' }];

    const { resolveClientBillingCurrency } = await import(
      '../src/actions/billingCurrencyActions'
    );

    await expect(
      resolveClientBillingCurrency(
        { user_id: 'user-1' },
        { tenant: 'tenant-1' },
        'client-1'
      )
    ).rejects.toThrow('Client has active contracts in multiple currencies');
  });
});
