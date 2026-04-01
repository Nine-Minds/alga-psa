import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = {
  existingSettings: Record<string, unknown> | null;
  updates: Array<{ table: string; filters: Record<string, unknown>; payload: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
};

const mockState: MockState = {
  existingSettings: null,
  updates: [],
  inserts: [],
};

const mockCreateTenantKnex = vi.fn(async () => ({ knex: {} }));
const mockHasPermission = vi.fn(async () => true);

function createMockQuery(
  table: string,
  initialFilters: Record<string, unknown>,
  state: MockState
) {
  let filters = { ...initialFilters };

  return {
    where(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return this;
    },
    async first() {
      if (table === 'default_billing_settings') {
        return state.existingSettings;
      }
      return null;
    },
    async update(payload: Record<string, unknown>) {
      state.updates.push({ table, filters: { ...filters }, payload });
      return 1;
    },
    async insert(payload: Record<string, unknown>) {
      state.inserts.push({ table, payload });
      return [payload];
    },
  };
}

function createMockTransaction(state: MockState) {
  const trx = ((table: string) => ({
    where(filters: Record<string, unknown>) {
      return createMockQuery(table, filters, state);
    },
    async insert(payload: Record<string, unknown>) {
      state.inserts.push({ table, payload });
      return [payload];
    },
  })) as any;

  trx.fn = {
    now: () => '2026-04-01T12:00:00.000Z',
  };

  return trx;
}

const mockWithTransaction = vi.fn(
  async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
    callback(createMockTransaction(mockState))
);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => mockCreateTenantKnex(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@shared/lib/boardScopedTicketStatusValidation', () => ({
  assertBoardScopedTicketStatusSelection: vi.fn(async () => {}),
}));

const baseSettings = {
  zeroDollarInvoiceHandling: 'normal' as const,
  suppressZeroDollarInvoices: false,
  defaultCurrencyCode: 'AUD',
};

describe('getDefaultBillingSettings — default currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = null;
    mockState.updates = [];
    mockState.inserts = [];
  });

  it('returns USD when no settings row exists', async () => {
    const { getDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await getDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' }
    );

    expect(result.defaultCurrencyCode).toBe('USD');
  });

  it('returns stored currency from existing settings', async () => {
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_currency_code: 'NZD',
    };

    const { getDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await getDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' }
    );

    expect(result.defaultCurrencyCode).toBe('NZD');
  });

  it('falls back to USD when column value is null', async () => {
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_currency_code: null,
    };

    const { getDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await getDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' }
    );

    expect(result.defaultCurrencyCode).toBe('USD');
  });
});

describe('updateDefaultBillingSettings — default currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
    };
    mockState.updates = [];
    mockState.inserts = [];
  });

  it('persists defaultCurrencyCode when updating existing settings', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      baseSettings
    );

    expect(result).toEqual({ success: true });
    expect(mockState.updates).toHaveLength(1);
    expect(mockState.updates[0]?.payload).toMatchObject({
      default_currency_code: 'AUD',
    });
  });

  it('persists defaultCurrencyCode when inserting new settings', async () => {
    mockState.existingSettings = null;

    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      baseSettings
    );

    expect(result).toEqual({ success: true });
    expect(mockState.inserts).toHaveLength(1);
    expect(mockState.inserts[0]?.payload).toMatchObject({
      default_currency_code: 'AUD',
    });
  });

  it('returns permission error when user lacks update permission', async () => {
    mockHasPermission.mockResolvedValueOnce(false);

    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      baseSettings
    );

    expect(result).toEqual({
      permissionError: 'Permission denied: Cannot update billing settings',
    });
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.inserts).toHaveLength(0);
  });

  it('falls back to USD when defaultCurrencyCode is empty', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { ...baseSettings, defaultCurrencyCode: '' }
    );

    expect(mockState.updates[0]?.payload).toMatchObject({
      default_currency_code: 'USD',
    });
  });
});
