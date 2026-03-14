/* @vitest-environment jsdom */

import React from 'react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CreateTicketFromAssetButton from './CreateTicketFromAssetButton';
import { AssetCrossFeatureProvider } from '../context/AssetCrossFeatureContext';

const mockGetAllPriorities = vi.fn();
const mockGetTicketStatuses = vi.fn();
const mockHandleError = vi.fn();
const mockPush = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockCreateTicketFromAsset = vi.fn();
const mockGetAllBoards = vi.fn();

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: (...args: unknown[]) => mockGetAllPriorities(...args),
  getTicketStatuses: (...args: unknown[]) => mockGetTicketStatuses(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => mockHandleError(...args),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => ({}),
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children }: any) =>
    isOpen ? (
      <div>
        <h1>{title}</h1>
        {children}
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ label, options = [], value, onValueChange, placeholder, disabled }: any) => (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
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
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, value, onChange, placeholder }: any) => (
    <label>
      <span>{label}</span>
      <input aria-label={label} value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, value, onChange, placeholder }: any) => (
    <label>
      <span>{label}</span>
      <textarea aria-label={label} value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  ),
}));

describe('CreateTicketFromAssetButton board-scoped statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllPriorities.mockResolvedValue([
      { priority_id: 'priority-1', priority_name: 'Medium' },
    ]);

    mockGetAllBoards.mockResolvedValue([
      { board_id: 'board-1', board_name: 'Service Desk', is_default: true },
      { board_id: 'board-2', board_name: 'Projects', is_default: false },
    ]);

    mockGetTicketStatuses.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-1') {
        return [
          { status_id: 'status-1', name: 'New', is_default: true },
          { status_id: 'status-2', name: 'In Progress', is_default: false },
        ];
      }

      if (boardId === 'board-2') {
        return [
          { status_id: 'status-3', name: 'Planned', is_default: true },
        ];
      }

      return [];
    });

    mockCreateTicketFromAsset.mockResolvedValue({
      ticket_id: 'ticket-1',
    });
  });

  it('T033: loads and submits statuses for the selected board only', async () => {
    const user = userEvent.setup();

    render(
      <AssetCrossFeatureProvider
        value={{
          renderQuickAddTicket: vi.fn(),
          openTicketDetailsDrawer: vi.fn(),
          createTicketFromAsset: mockCreateTicketFromAsset,
          getAllBoards: mockGetAllBoards,
        }}
      >
        <CreateTicketFromAssetButton
          asset={{
            asset_id: 'asset-1',
            client_id: 'client-1',
            name: 'Router',
          } as any}
        />
      </AssetCrossFeatureProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    const boardSelect = await screen.findByLabelText('Board');
    const statusSelect = await screen.findByLabelText('Status');
    const prioritySelect = await screen.findByLabelText('Priority');

    await waitFor(() => expect(mockGetTicketStatuses).toHaveBeenCalledWith('board-1'));
    expect(mockGetTicketStatuses).not.toHaveBeenCalledWith();
    expect((statusSelect as HTMLSelectElement).value).toBe('status-1');
    expect(screen.getByRole('option', { name: 'New' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Planned' })).toBeNull();

    await user.selectOptions(statusSelect, 'status-2');
    expect((statusSelect as HTMLSelectElement).value).toBe('status-2');

    await user.selectOptions(boardSelect, 'board-2');

    await waitFor(() => expect(mockGetTicketStatuses).toHaveBeenLastCalledWith('board-2'));
    await waitFor(() => expect((statusSelect as HTMLSelectElement).value).toBe('status-3'));

    expect(screen.getByRole('option', { name: 'Planned' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'In Progress' })).toBeNull();

    await user.selectOptions(prioritySelect, 'priority-1');
    await user.click(screen.getAllByRole('button', { name: 'Create Ticket' })[1]!);

    expect(mockCreateTicketFromAsset).toHaveBeenCalledWith({
      title: 'Issue with Router',
      description: '',
      priority_id: 'priority-1',
      status_id: 'status-3',
      board_id: 'board-2',
      asset_id: 'asset-1',
      client_id: 'client-1',
    });
    expect(mockPush).toHaveBeenCalledWith('/msp/tickets/ticket-1');
    expect(mockToastSuccess).toHaveBeenCalledWith('Ticket created successfully');
  });
});
