import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = {
  defaultSettings: Record<string, unknown> | null;
  clientSettings: Record<string, unknown> | null;
  updates: Array<{ table: string; filters: Record<string, unknown>; payload: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
};

const mockState: MockState = {
  defaultSettings: null,
  clientSettings: null,
  updates: [],
  inserts: [],
};

const mockCreateTenantKnex = vi.fn(async () => ({ knex: {} }));
const mockHasPermission = vi.fn(async () => true);
const mockUpdateClientBillingSettingsShared = vi.fn(async () => undefined);

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
        return state.defaultSettings;
      }
      if (table === 'client_billing_settings') {
        // Honor the client_id filter so a lookup for another client misses.
        if (state.clientSettings && filters.client_id && filters.client_id !== state.clientSettings.client_id) {
          return null;
        }
        return state.clientSettings;
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
    now: () => '2026-09-21T12:00:00.000Z',
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

vi.mock('@shared/billingClients/billingSettings', () => ({
  updateClientBillingSettings: (...args: unknown[]) => mockUpdateClientBillingSettingsShared(...args),
}));

describe('default time-entry service — tenant settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.defaultSettings = null;
    mockState.clientSettings = null;
    mockState.updates = [];
    mockState.inserts = [];
    mockHasPermission.mockResolvedValue(true);
  });

  it('loads the stored tenant default service', async () => {
    mockState.defaultSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: 'service-tenant',
    };

    const { getDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');
    const result = await getDefaultBillingSettings({ user_id: 'user-1' }, { tenant: 'tenant-1' });

    expect(result).toMatchObject({ defaultTimeEntryServiceId: 'service-tenant' });
  });

  it('returns undefined when the tenant default is cleared', async () => {
    mockState.defaultSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: null,
    };

    const { getDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');
    const result = await getDefaultBillingSettings({ user_id: 'user-1' }, { tenant: 'tenant-1' });

    expect(result).toMatchObject({ defaultTimeEntryServiceId: undefined });
  });

  it('persists the tenant default service without touching other columns', async () => {
    mockState.defaultSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: null,
    };

    const { updateDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');
    const result = await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultTimeEntryServiceId: 'service-tenant' }
    );

    expect(result).toEqual({ success: true });
    expect(mockState.updates).toHaveLength(1);
    expect(mockState.updates[0]?.payload).toMatchObject({
      default_time_entry_service_id: 'service-tenant',
    });
    expect(mockState.updates[0]?.payload).not.toHaveProperty('zero_dollar_invoice_handling');
  });

  it('clears the tenant default service when null is supplied', async () => {
    mockState.defaultSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: 'service-tenant',
    };

    const { updateDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');
    await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultTimeEntryServiceId: null }
    );

    expect(mockState.updates[0]?.payload).toMatchObject({
      default_time_entry_service_id: null,
    });
  });

  it('inserts the tenant default service when no settings row exists', async () => {
    mockState.defaultSettings = null;

    const { updateDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');
    await updateDefaultBillingSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { defaultTimeEntryServiceId: 'service-tenant' }
    );

    expect(mockState.inserts).toHaveLength(1);
    expect(mockState.inserts[0]?.payload).toMatchObject({
      default_time_entry_service_id: 'service-tenant',
    });
  });
});

describe('default time-entry service — client settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.defaultSettings = null;
    mockState.clientSettings = null;
    mockState.updates = [];
    mockState.inserts = [];
    mockHasPermission.mockResolvedValue(true);
  });

  it('loads the stored client default service', async () => {
    mockState.clientSettings = {
      tenant: 'tenant-1',
      client_id: 'client-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: 'service-client',
    };

    const { getClientContractLineSettings } = await import('../src/actions/billingSettingsActions');
    const result = await getClientContractLineSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toMatchObject({ defaultTimeEntryServiceId: 'service-client' });
  });

  it('passes the client default service through to the shared update path', async () => {
    const { updateClientContractLineSettings } = await import('../src/actions/billingSettingsActions');
    const result = await updateClientContractLineSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1',
      { defaultTimeEntryServiceId: 'service-client' } as any
    );

    expect(result).toEqual({ success: true });
    expect(mockUpdateClientBillingSettingsShared).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'client-1',
      expect.objectContaining({ defaultTimeEntryServiceId: 'service-client' })
    );
  });

  it('does not let a client write carry a different client id', async () => {
    mockState.clientSettings = {
      tenant: 'tenant-1',
      client_id: 'client-2',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      default_time_entry_service_id: 'service-other',
    };

    const { getClientContractLineSettings } = await import('../src/actions/billingSettingsActions');
    const result = await getClientContractLineSettings(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'client-1'
    );

    expect(result).toBeNull();
  });
});
