/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetDefaultBillingSettings = vi.fn();
const mockUpdateDefaultBillingSettings = vi.fn();
const mockGetAllBoards = vi.fn();
const mockGetTicketStatuses = vi.fn();
const mockHandleError = vi.fn();

vi.mock('@alga-psa/billing/actions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => mockGetDefaultBillingSettings(...args),
  updateDefaultBillingSettings: (...args: unknown[]) => mockUpdateDefaultBillingSettings(...args),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getAllBoards: (...args: unknown[]) => mockGetAllBoards(...args),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => mockGetTicketStatuses(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => mockHandleError(...args),
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    options = [],
    value,
    onValueChange,
    placeholder,
    disabled,
  }: any) => (
    <select
      id={id}
      data-testid={`${id}-select`}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select option'}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('RenewalAutomationSettings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    mockGetDefaultBillingSettings.mockResolvedValue({
      zeroDollarInvoiceHandling: 'normal',
      suppressZeroDollarInvoices: false,
      enableCreditExpiration: true,
      creditExpirationDays: 365,
      creditExpirationNotificationDays: [30, 7, 1],
      defaultRenewalMode: 'manual',
      defaultNoticePeriodDays: 30,
      renewalDueDateActionPolicy: 'create_ticket',
      renewalTicketBoardId: undefined,
      renewalTicketStatusId: undefined,
      renewalTicketPriority: undefined,
      renewalTicketAssigneeId: undefined,
    });
    mockUpdateDefaultBillingSettings.mockResolvedValue({ success: true });
    mockGetAllBoards.mockResolvedValue([
      { board_id: 'board-1', board_name: 'Service Desk' },
      { board_id: 'board-2', board_name: 'Projects' },
    ]);
    mockGetTicketStatuses.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-1') {
        return [
          { status_id: 'status-1', name: 'New' },
          { status_id: 'status-2', name: 'In Progress' },
        ];
      }

      if (boardId === 'board-2') {
        return [{ status_id: 'status-3', name: 'Planned' }];
      }

      return [];
    });
  });

  it('loads statuses for the selected board only and clears stale status selections when the board changes', async () => {
    const { default: RenewalAutomationSettings } = await import(
      '../src/components/settings/billing/RenewalAutomationSettings'
    );
    const user = userEvent.setup();

    await act(async () => {
      render(<RenewalAutomationSettings />);
    });

    const boardSelect = await screen.findByTestId('renewal-ticket-board-select');
    const statusSelect = await screen.findByTestId('renewal-ticket-status-select');

    expect(statusSelect).toBeDisabled();

    await act(async () => {
      await user.selectOptions(boardSelect, 'board-1');
    });
    await waitFor(() => expect(mockGetTicketStatuses).toHaveBeenLastCalledWith('board-1'));

    expect(statusSelect).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'New' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Planned' })).not.toBeInTheDocument();

    await act(async () => {
      await user.selectOptions(statusSelect, 'status-2');
    });
    expect((statusSelect as HTMLSelectElement).value).toBe('status-2');

    await act(async () => {
      await user.selectOptions(boardSelect, 'board-2');
    });
    await waitFor(() => expect(mockGetTicketStatuses).toHaveBeenLastCalledWith('board-2'));

    expect((statusSelect as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'Planned' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'In Progress' })).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(mockUpdateDefaultBillingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        renewalTicketBoardId: 'board-2',
        renewalTicketStatusId: undefined,
      })
    );
  });
});
