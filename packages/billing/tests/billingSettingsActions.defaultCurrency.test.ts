import { beforeEach, describe, expect, it, vi } from 'vitest';

type ClientRow = { client_id: string; default_currency_code: string };

type MockState = {
  existingSettings: Record<string, unknown> | null;
  updates: Array<{ table: string; filters: Record<string, unknown>; payload: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  clients: ClientRow[];
  lockedSettingsReads: number;
};

const mockState: MockState = {
  existingSettings: null,
  updates: [],
  inserts: [],
  clients: [],
  lockedSettingsReads: 0,
};

const mockCreateTenantKnex = vi.fn(async () => ({ knex: {} }));
const mockHasPermission = vi.fn(async () => true);

function createMockQuery(
  table: string,
  initialFilters: Record<string, unknown>,
  state: MockState
) {
  let filters = { ...initialFilters };
  let countRequested = false;

  const query = {
    where(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return query;
    },
    forUpdate() {
      state.lockedSettingsReads += 1;
      return query;
    },
    count() {
      countRequested = true;
      return query;
    },
    async first() {
      if (table === 'default_billing_settings') {
        return state.existingSettings;
      }
      if (countRequested && table === 'clients') {
        return { count: String(state.clients.length) };
      }
      return null;
    },
    async update(payload: Record<string, unknown>) {
      state.updates.push({ table, filters: { ...filters }, payload });
      if (table === 'clients') {
        const match = filters.default_currency_code;
        const affected = state.clients.filter((client) => client.default_currency_code === match);
        for (const client of affected) {
          client.default_currency_code = String(payload.default_currency_code);
        }
        return affected.length;
      }
      return 1;
    },
    async insert(payload: Record<string, unknown>) {
      state.inserts.push({ table, payload });
      return [payload];
    },
  };

  return query;
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
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table),
  }),
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

const settingsUpdates = () =>
  mockState.updates.filter((update) => update.table === 'default_billing_settings');
const clientUpdates = () =>
  mockState.updates.filter((update) => update.table === 'clients');

describe('getDefaultBillingSettings — default currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = null;
    mockState.updates = [];
    mockState.inserts = [];
    mockState.clients = [];
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
      default_currency_code: 'USD',
    };
    mockState.updates = [];
    mockState.inserts = [];
    mockState.clients = [];
    mockState.lockedSettingsReads = 0;
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

    expect(result).toMatchObject({
      success: true,
      previousCurrencyCode: 'USD',
      currencyCode: 'AUD',
    });
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]?.payload).toMatchObject({
      default_currency_code: 'AUD',
    });
  });

  it('locks the settings row before deciding whether to propagate', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      baseSettings
    );

    expect(mockState.lockedSettingsReads).toBe(1);
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

    expect(result).toMatchObject({ success: true, previousCurrencyCode: 'USD', currencyCode: 'AUD' });
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
      messageKey: 'msp/billing-settings:errors.permissions.updateSettings',
    });
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.inserts).toHaveLength(0);
  });

  it('falls back to USD when defaultCurrencyCode is empty', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { ...baseSettings, defaultCurrencyCode: '' }
    );

    expect(settingsUpdates()[0]?.payload).toMatchObject({
      default_currency_code: 'USD',
    });
    // Empty normalizes to the existing default, so no propagation is claimed.
    expect(result).toMatchObject({ success: true, currencyCode: 'USD' });
    expect(result).not.toHaveProperty('propagatedClientCount');
  });
});

describe('updateDefaultBillingSettings — client currency propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_currency_code: 'USD',
    };
    mockState.updates = [];
    mockState.inserts = [];
    mockState.clients = [
      { client_id: 'client-1', default_currency_code: 'USD' },
      { client_id: 'client-2', default_currency_code: 'EUR' },
      { client_id: 'client-3', default_currency_code: 'USD' },
    ];
    mockState.lockedSettingsReads = 0;
  });

  it('updates clients on the previous default and preserves clients on another currency', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultCurrencyCode: 'AUD' }
    );

    expect(result).toMatchObject({
      success: true,
      previousCurrencyCode: 'USD',
      currencyCode: 'AUD',
      propagatedClientCount: 2,
      preservedClientCount: 1,
    });
    expect(mockState.clients).toEqual([
      { client_id: 'client-1', default_currency_code: 'AUD' },
      { client_id: 'client-2', default_currency_code: 'EUR' },
      { client_id: 'client-3', default_currency_code: 'AUD' },
    ]);
    expect(clientUpdates()).toHaveLength(1);
    expect(clientUpdates()[0]?.filters).toMatchObject({ default_currency_code: 'USD' });
    expect(clientUpdates()[0]?.payload).toMatchObject({ default_currency_code: 'AUD' });
  });

  it('does not touch clients when the normalized currency is unchanged', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultCurrencyCode: 'USD' }
    );

    expect(result).toMatchObject({ success: true, previousCurrencyCode: 'USD', currencyCode: 'USD' });
    expect(result).not.toHaveProperty('propagatedClientCount');
    expect(clientUpdates()).toHaveLength(0);
    expect(mockState.clients.map((client) => client.default_currency_code)).toEqual(['USD', 'EUR', 'USD']);
  });

  it('does not touch clients for an unrelated partial billing-settings save', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultRenewalMode: 'manual', defaultNoticePeriodDays: 30 }
    );

    expect(result).toEqual({ success: true });
    expect(clientUpdates()).toHaveLength(0);
    expect(settingsUpdates()).toHaveLength(1);
  });

  it('issues no client writes when the permission check fails', async () => {
    mockHasPermission.mockResolvedValueOnce(false);

    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultCurrencyCode: 'AUD' }
    );

    expect(mockState.updates).toHaveLength(0);
    expect(mockState.lockedSettingsReads).toBe(0);
    expect(mockState.clients.map((client) => client.default_currency_code)).toEqual(['USD', 'EUR', 'USD']);
  });
});

// The billing settings page's sections each save against the same row. A
// section's save must write only its own keys — a renewal save carrying a
// stale snapshot used to revert a just-saved currency change (prod repro).
describe('updateDefaultBillingSettings — partial saves do not clobber other sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_currency_code: 'GBP',
    };
    mockState.updates = [];
    mockState.inserts = [];
    mockState.clients = [];
  });

  it('a renewal-only save leaves default_currency_code unwritten', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultRenewalMode: 'manual', defaultNoticePeriodDays: 30 }
    );

    expect(result).toEqual({ success: true });
    expect(settingsUpdates()).toHaveLength(1);
    expect(settingsUpdates()[0]?.payload).toMatchObject({
      default_renewal_mode: 'manual',
      default_notice_period_days: 30,
    });
    expect(settingsUpdates()[0]?.payload).not.toHaveProperty('default_currency_code');
    expect(settingsUpdates()[0]?.payload).not.toHaveProperty('zero_dollar_invoice_handling');
  });

  it('a currency-only save writes only the currency column', async () => {
    const { updateDefaultBillingSettings } = await import(
      '../src/actions/billingSettingsActions'
    );

    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultCurrencyCode: 'EUR' }
    );

    expect(result).toMatchObject({ success: true, currencyCode: 'EUR', previousCurrencyCode: 'GBP' });
    expect(settingsUpdates()).toHaveLength(1);
    expect(Object.keys(settingsUpdates()[0]?.payload ?? {}).sort()).toEqual([
      'default_currency_code',
      'updated_at',
    ]);
  });
});
