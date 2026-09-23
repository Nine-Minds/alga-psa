/* @vitest-environment jsdom */

/**
 * Focused component coverage for contract-detail navigation from the client
 * window (alga-2026-0002526).
 *
 * The contract name and the new "View details" menu action must both push the
 * canonical Billing client-contract detail URL for the exact assignment, and
 * neither may bubble to the table row (which opens the assignment editor).
 * Row click and Edit must keep opening that editor without navigating.
 *
 * DataTable and DropdownMenu are replaced with deterministic harnesses that
 * keep the row's click handler and the inline menu items wired the way the real
 * components are, so propagation is genuinely exercised instead of shielded by
 * Radix portals.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.hoisted(() => vi.fn());

const getClientContractsMock = vi.hoisted(() => vi.fn());
const getDetailedClientContractMock = vi.hoisted(() => vi.fn());
const getClientByIdMock = vi.hoisted(() => vi.fn());
const updateClientContractMock = vi.hoisted(() => vi.fn());
const deactivateClientContractMock = vi.hoisted(() => vi.fn());
const getClientBillingProfilesMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientContracts: (...args: unknown[]) => getClientContractsMock(...args),
  getDetailedClientContract: (...args: unknown[]) => getDetailedClientContractMock(...args),
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
  updateClientContract: (...args: unknown[]) => updateClientContractMock(...args),
  deactivateClientContract: (...args: unknown[]) => deactivateClientContractMock(...args),
}));

vi.mock('../../actions/clientBillingProfileActions', () => ({
  getClientBillingProfiles: (...args: unknown[]) => getClientBillingProfilesMock(...args),
  assignBillingProfile: vi.fn(),
}));

vi.mock('@alga-psa/clients/context/ClientCrossFeatureContext', () => ({
  useClientCrossFeature: () => ({
    renderContractWizard: undefined,
    renderContractQuickAdd: undefined,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({
  UNASSIGNED_BILLING_PROFILE_VALUE: '__unassigned__',
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => null,
}));

vi.mock('./ClientContractDialog', () => ({
  ClientContractDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="client-contract-dialog" /> : null,
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
  DropdownMenuItem: ({
    children,
    id,
    onClick,
  }: {
    children: React.ReactNode;
    id?: string;
    onClick?: (event: React.MouseEvent) => void;
  }) => (
    <button type="button" id={id} onClick={onClick}>
      {children}
    </button>
  ),
}));

import ClientContractAssignment from './ClientContractAssignment';

const CANONICAL_URL =
  '/msp/billing?tab=client-contracts&contractId=contract-1&clientContractId=cc-1';

describe('ClientContractAssignment contract-detail navigation', () => {
  beforeEach(() => {
    pushMock.mockReset();
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
    getClientByIdMock.mockReset().mockResolvedValue({ client_name: 'Acme Corp' });
    getClientBillingProfilesMock.mockReset().mockResolvedValue([]);
    updateClientContractMock.mockReset();
    deactivateClientContractMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to the canonical client-contract URL when the contract name is activated', async () => {
    render(<ClientContractAssignment clientId="client-1" />);

    const nameButton = await screen.findByTestId('client-contract-name-cc-1');
    await userEvent.click(nameButton);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(CANONICAL_URL);
    expect(screen.queryByTestId('client-contract-dialog')).toBeNull();
  });

  it('navigates to the same canonical URL from the View details menu action', async () => {
    render(<ClientContractAssignment clientId="client-1" />);

    const viewDetails = await screen.findByRole('button', { name: 'View details' });
    await userEvent.click(viewDetails);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(CANONICAL_URL);
    expect(screen.queryByTestId('client-contract-dialog')).toBeNull();
  });

  it('still opens the assignment editor from a row click without navigating', async () => {
    render(<ClientContractAssignment clientId="client-1" />);

    const descriptionCell = await screen.findByText('Support plan');
    await userEvent.click(descriptionCell);

    expect(await screen.findByTestId('client-contract-dialog')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('still opens the assignment editor from the Edit menu action without navigating', async () => {
    render(<ClientContractAssignment clientId="client-1" />);

    const editAction = await screen.findByRole('button', { name: 'Edit' });
    await userEvent.click(editAction);

    expect(await screen.findByTestId('client-contract-dialog')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('gives each row a distinct View details menu item id', async () => {
    getClientContractsMock.mockResolvedValue([
      {
        client_contract_id: 'cc-1',
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-01-01',
        end_date: null,
        is_active: true,
      },
      {
        client_contract_id: 'cc-2',
        client_id: 'client-1',
        contract_id: 'contract-2',
        start_date: '2026-01-01',
        end_date: null,
        is_active: true,
      },
    ]);
    getDetailedClientContractMock.mockImplementation(async (clientContractId: string) => ({
      contract_name: clientContractId === 'cc-1' ? 'Managed Services' : 'Backup',
      description: 'Service',
      contract_line_count: 0,
      contract_line_names: [],
    }));

    render(<ClientContractAssignment clientId="client-1" />);

    await screen.findByTestId('client-contract-name-cc-2');

    const ids = Array.from(
      document.querySelectorAll('[id^="view-client-contract-details-menu-item-"]'),
    ).map((element) => element.id);

    expect(ids).toEqual([
      'view-client-contract-details-menu-item-cc-1',
      'view-client-contract-details-menu-item-cc-2',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
