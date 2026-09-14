/**
 * @vitest-environment jsdom
 *
 * Composed coverage for a real connection-read failure reaching the dialog.
 *
 * The component is rendered against the REAL getAccountingExportConnections
 * action (only the credential store and DB handles are faked), so a store
 * outage surfaces the Retry affordance instead of silently disabling Create,
 * and Retry recovers once the store responds.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const state = vi.hoisted(() => ({
  failXero: true,
  capabilities: {
    catalogRead: false,
    connectionsManage: false,
    mappingsManage: false,
    exportsExecute: true,
    remoteMutate: false,
    hasAny: true,
    loaded: true,
  },
}));

vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => state.capabilities,
}));

// Keep the real connection action; stub the rest of the export actions so the
// dialog can mount without a server.
vi.mock('@alga-psa/billing/actions/accountingExportActions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@alga-psa/billing/actions/accountingExportActions')>();
  return {
    ...actual,
    listAccountingExportBatches: async () => [],
    getAccountingExportBatch: async () => ({ batch: null, lines: [], errors: [] }),
    createAccountingExportBatch: vi.fn(),
    executeAccountingExportBatch: vi.fn(),
    cancelAccountingExportBatch: vi.fn(),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action({ user_id: 'u1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

function settingsBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.first = async () => ({ settings: { accountingSync: { defaultRealm: null } } });
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: () => settingsBuilder() }),
  writeAccountingAudit: async () => undefined,
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => {
    if (state.failXero) {
      throw new Error('Credential store temporarily unavailable');
    }
    return {
      'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
      'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' },
    };
  },
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-a' }),
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: async () => ({ 'qbo-realm-a': { realmId: 'qbo-realm-a' } }),
  getDefaultQboRealmId: async () => 'qbo-realm-a',
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: {
    id?: string;
    value?: string | null;
    onValueChange?: (value: string) => void;
    options?: Array<{ value: string; label: React.ReactNode }>;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: { id?: string }) => <input id={id} data-testid={id} readOnly />,
}));

async function renderTab() {
  const { default: AccountingExportsTab } = await import(
    '../../src/components/billing-dashboard/accounting/AccountingExportsTab'
  );
  render(<AccountingExportsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'New Export' }));
  await screen.findByTestId('accounting-export-adapter');
}

beforeEach(() => {
  vi.clearAllMocks();
  state.failXero = true;
});

afterEach(() => {
  cleanup();
});

describe('AccountingExportsTab real connection-read failure', () => {
  it('shows an actionable Retry on a store outage and recovers when Retry succeeds', async () => {
    await renderTab();

    fireEvent.change(screen.getByTestId('accounting-export-adapter'), {
      target: { value: 'xero' },
    });

    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent(/could not load accounting connections/i);
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeDisabled();

    // Store recovers; Retry re-runs the real action and loads the picker.
    state.failXero = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.getElementById('accounting-export-connections-error')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('conn-a');
    });
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
  });
});
