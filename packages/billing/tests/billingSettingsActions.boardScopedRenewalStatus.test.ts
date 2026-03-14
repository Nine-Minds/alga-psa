import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = {
  existingSettings: Record<string, unknown> | null;
  statuses: Array<Record<string, unknown>>;
  updates: Array<{ table: string; filters: Record<string, unknown>; payload: Record<string, unknown> }>;
};

const mockState: MockState = {
  existingSettings: null,
  statuses: [],
  updates: [],
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

      if (table === 'statuses') {
        return state.statuses.find((status) =>
          Object.entries(filters).every(([key, value]) => status[key] === value)
        );
      }

      return null;
    },
    async update(payload: Record<string, unknown>) {
      state.updates.push({ table, filters: { ...filters }, payload });
      return 1;
    },
    async insert(payload: Record<string, unknown>) {
      state.updates.push({ table, filters: { ...filters }, payload });
      return [payload];
    },
  };
}

function createMockTransaction(state: MockState) {
  const trx = ((table: string) => ({
    where(filters: Record<string, unknown>) {
      return createMockQuery(table, filters, state);
    },
  })) as any;

  trx.schema = {
    hasColumn: vi.fn(async () => true),
  };
  trx.fn = {
    now: () => '2026-03-14T12:00:00.000Z',
  };

  return trx;
}

const mockWithTransaction = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => (
  callback(createMockTransaction(mockState))
));

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

const baseSettings = {
  zeroDollarInvoiceHandling: 'normal' as const,
  suppressZeroDollarInvoices: false,
  enableCreditExpiration: true,
  creditExpirationDays: 365,
  creditExpirationNotificationDays: [30, 7, 1],
  defaultRenewalMode: 'manual' as const,
  defaultNoticePeriodDays: 30,
  renewalDueDateActionPolicy: 'create_ticket' as const,
  renewalTicketBoardId: 'board-1',
  renewalTicketStatusId: 'status-1',
  renewalTicketPriority: undefined,
  renewalTicketAssigneeId: undefined,
};

describe('updateDefaultBillingSettings board-scoped renewal ticket validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existingSettings = {
      tenant: 'tenant-1',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
    };
    mockState.statuses = [
      {
        status_id: 'status-1',
        board_id: 'board-1',
        tenant: 'tenant-1',
        status_type: 'ticket',
      },
    ];
    mockState.updates = [];
  });

  it('accepts renewal ticket statuses that belong to the selected board', async () => {
    const { updateDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');

    await expect(
      updateDefaultBillingSettings(
        { user_id: 'user-1' },
        { tenant: 'tenant-1' },
        baseSettings
      )
    ).resolves.toEqual({ success: true });

    expect(mockState.updates).toHaveLength(1);
    expect(mockState.updates[0]?.payload).toMatchObject({
      renewal_ticket_board_id: 'board-1',
      renewal_ticket_status_id: 'status-1',
    });
  });

  it('rejects stale renewal ticket statuses from another board before save', async () => {
    const { updateDefaultBillingSettings } = await import('../src/actions/billingSettingsActions');

    await expect(
      updateDefaultBillingSettings(
        { user_id: 'user-1' },
        { tenant: 'tenant-1' },
        {
          ...baseSettings,
          renewalTicketBoardId: 'board-2',
          renewalTicketStatusId: 'status-1',
        }
      )
    ).rejects.toThrow('Renewal ticket status must belong to the selected board');

    expect(mockState.updates).toHaveLength(0);
  });
});
