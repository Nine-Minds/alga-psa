/* @vitest-environment jsdom */

/**
 * The contract-assignment edit dialog renders inline, so wherever
 * ClientContractAssignment sits in the tree, the dialog's <form> is a DOM descendant
 * of whatever form encloses it. When BillingConfiguration wrapped the Contracts tab
 * in its own <form>, "Update Assignment" never reached the dialog's handler (invalid
 * nested forms) and the billing-settings submit handler was the one that ran.
 *
 * Real BillingConfiguration, ClientContractAssignment and ClientContractDialog; only
 * the data layer and the unrelated billing-settings sections are replaced.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getClientContractsMock = vi.hoisted(() => vi.fn());
const getDetailedClientContractMock = vi.hoisted(() => vi.fn());
const updateClientContractMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientContracts: (...args: unknown[]) => getClientContractsMock(...args),
  getDetailedClientContract: (...args: unknown[]) => getDetailedClientContractMock(...args),
  getClientById: vi.fn().mockResolvedValue({ client_name: 'Acme Corp' }),
  updateClientContract: (...args: unknown[]) => updateClientContractMock(...args),
  deactivateClientContract: vi.fn(),
  getClientTaxRates: vi.fn().mockResolvedValue([]),
  addClientTaxRate: vi.fn(),
  updateDefaultClientTaxRate: vi.fn(),
}));

vi.mock('../../actions/clientBillingProfileActions', () => ({
  getClientBillingProfiles: vi.fn().mockResolvedValue([]),
  assignBillingProfile: vi.fn(),
}));

vi.mock('../../lib/billingHelpers', () => ({
  getTaxRatesAsync: vi.fn().mockResolvedValue([]),
  setClientTemplateAsync: vi.fn(),
}));

vi.mock('@alga-psa/clients/context/ClientCrossFeatureContext', () => ({
  useClientCrossFeature: () => ({ renderContractWizard: undefined, renderContractQuickAdd: undefined }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { formatDateValue } = await import('@alga-psa/ui/lib/i18n/formatDateValue');
  return {
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    }),
    useFormatters: () => ({
      locale: 'en',
      formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
        formatDateValue(date, 'en', options),
    }),
  };
});

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({ UNASSIGNED_BILLING_PROFILE_VALUE: '__unassigned__' }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: { id: string }) => <input id={id} readOnly />,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    data,
    columns,
    onRowClick,
  }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{ dataIndex: string; render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode }>;
    onRowClick?: (record: Record<string, unknown>) => void;
  }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={String(row.client_contract_id)} onClick={() => onRowClick?.(row)}>
            {columns.map((column, index) => (
              <td key={index}>
                {column.render ? column.render(row[column.dataIndex], row) : String(row[column.dataIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id, onClick }: { children: React.ReactNode; id?: string; onClick?: (e: React.MouseEvent) => void }) => (
    <button type="button" id={id} onClick={onClick}>{children}</button>
  ),
}));

// Unrelated billing-settings sections (their own data loading is not under test).
vi.mock('./BillingConfigForm', () => ({ default: () => <div data-testid="billing-config-form" /> }));
vi.mock('./ClientTaxRates', () => ({ default: () => null }));
vi.mock('./ClientZeroDollarInvoiceSettings', () => ({ default: () => null }));
vi.mock('./ClientDefaultTimeEntryServiceSettings', () => ({ default: () => null }));
vi.mock('./ClientCreditExpirationSettings', () => ({ default: () => null }));
vi.mock('./ClientCreditDrawdownSettings', () => ({ default: () => null }));
vi.mock('./ClientExternalCreditSettings', () => ({ default: () => null }));
vi.mock('./ClientPrepaidBalanceAlertSettings', () => ({ default: () => null }));
vi.mock('./ClientBillingProfiles', () => ({ default: () => null }));
vi.mock('./ClientBillingSchedule', () => ({ ClientBillingSchedule: () => null }));

import { InsideDialogContext } from '@alga-psa/ui/components/ModalityContext';
import BillingConfiguration from './BillingConfiguration';

describe('BillingConfiguration > Contracts > Update Assignment', () => {
  beforeEach(() => {
    getClientContractsMock.mockReset().mockResolvedValue([
      {
        client_contract_id: 'cc-1',
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-01-01',
        end_date: null,
        is_active: true,
      },
    ]);
    getDetailedClientContractMock.mockReset().mockResolvedValue({
      contract_name: 'Managed Services',
      description: 'Support plan',
      contract_line_count: 1,
      contract_line_names: ['Standard'],
    });
    updateClientContractMock.mockReset().mockResolvedValue({ client_contract_id: 'cc-1' });
  });

  // In the app BillingConfiguration lives in the client Drawer, so the dialog renders inline
  // (DOM-nested in whatever form encloses it). Outside a Drawer it is portaled, but React
  // synthetic events still bubble through the React tree to an enclosing <form onSubmit>.
  it.each([
    ['inside a Drawer (inline dialog)', true],
    ['at top level (portaled dialog)', false],
  ])('runs the dialog save and not the billing-settings save, with no nested form: %s', async (_label, insideDrawer) => {
    const onSave = vi.fn();
    render(
      <InsideDialogContext.Provider value={insideDrawer}>
        <BillingConfiguration client={{ client_id: 'client-1', client_name: 'Acme Corp' } as any} onSave={onSave} />
      </InsideDialogContext.Provider>
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Contracts' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const dialogForm = await waitFor(() => {
      const form = document.getElementById('client-contract-dialog-form');
      expect(form).not.toBeNull();
      return form as HTMLFormElement;
    });
    // Structural guarantee: the dialog's form has no <form> ancestor.
    expect(dialogForm.parentElement?.closest('form')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Update Assignment' }));

    await waitFor(() => expect(updateClientContractMock).toHaveBeenCalledTimes(1));
    expect(updateClientContractMock).toHaveBeenCalledWith(
      'cc-1',
      expect.objectContaining({ start_date: '2026-01-01', end_date: null })
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
