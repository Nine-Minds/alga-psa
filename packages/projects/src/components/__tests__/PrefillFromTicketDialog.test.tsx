/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrefillFromTicketDialog from '../PrefillFromTicketDialog';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

function createMockTicketIntegration(
  overrides: Partial<TicketIntegrationContextType> = {}
): TicketIntegrationContextType {
  return {
    getTicketsForList: vi.fn().mockResolvedValue([]),
    getConsolidatedTicketData: vi.fn().mockResolvedValue({}),
    getTicketCategories: vi.fn().mockResolvedValue([]),
    getAllBoards: vi.fn().mockResolvedValue([]),
    openTicketInDrawer: vi.fn().mockResolvedValue(undefined),
    renderQuickAddTicket: vi.fn().mockReturnValue(null),
    renderCategoryPicker: vi.fn().mockReturnValue(null),
    renderPrioritySelect: vi.fn().mockReturnValue(null),
    deleteTicket: vi.fn(),
    ...overrides,
  };
}

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../TicketSelect', () => ({
  __esModule: true,
  default: ({ options, value, onValueChange, searchValue, onSearchChange }: any) => (
    <div>
      <input
        aria-label="ticket-search"
        value={searchValue}
        onChange={(event) => onSearchChange?.(event.target.value)}
      />
      <select
        aria-label="ticket-select"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="" />
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}));

describe('PrefillFromTicketDialog', () => {
  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
  });

  it('renders ticket search input and TicketSelect dropdown', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={() => undefined}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    expect(screen.getByLabelText('ticket-search')).toBeInTheDocument();
    expect(screen.getByLabelText('ticket-select')).toBeInTheDocument();
  });

  it('fetches tickets lazily when dialog opens', () => {
    const { rerender } = render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={false}
          onOpenChange={() => undefined}
          onPrefill={() => undefined}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    expect(mockCtx.getTicketsForList).not.toHaveBeenCalled();

    rerender(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={() => undefined}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    expect(mockCtx.getTicketsForList).toHaveBeenCalledTimes(1);
  });

  it('renders auto-link checkbox checked by default', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={() => undefined}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    const checkbox = screen.getByLabelText('Link this ticket to the task') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('excludes ticket link when auto-link is unchecked', async () => {
    mockCtx = createMockTicketIntegration({
      getTicketsForList: vi.fn().mockResolvedValue([
        { ticket_id: 'ticket-1', ticket_number: 'T-001', title: 'Printer issue', status_name: 'New' }
      ]),
      getConsolidatedTicketData: vi.fn().mockResolvedValue({
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Printer issue',
        status_name: 'New',
        is_closed: false
      }),
    });

    const onPrefill = vi.fn();

    render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={onPrefill}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    await waitFor(() => expect(mockCtx.getTicketsForList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('ticket-select'), {
      target: { value: 'ticket-1' }
    });

    const checkbox = screen.getByLabelText('Link this ticket to the task');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: 'Prefill' }));

    expect(onPrefill).toHaveBeenCalledWith(
      expect.objectContaining({ shouldLink: false })
    );
  });

  it('calls getConsolidatedTicketData for the selected ticket on confirm', async () => {
    mockCtx = createMockTicketIntegration({
      getTicketsForList: vi.fn().mockResolvedValue([
        { ticket_id: 'ticket-2', ticket_number: 'T-002', title: 'VPN issue', status_name: 'New' }
      ]),
      getConsolidatedTicketData: vi.fn().mockResolvedValue({
        ticket_id: 'ticket-2',
        ticket_number: 'T-002',
        title: 'VPN issue'
      }),
    });

    render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={() => undefined}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    await waitFor(() => expect(mockCtx.getTicketsForList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('ticket-select'), {
      target: { value: 'ticket-2' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prefill' }));

    expect(mockCtx.getConsolidatedTicketData).toHaveBeenCalledWith('ticket-2');
  });

  it('returns mapped fields via onPrefill', async () => {
    mockCtx = createMockTicketIntegration({
      getTicketsForList: vi.fn().mockResolvedValue([
        { ticket_id: 'ticket-3', ticket_number: 'T-003', title: 'WiFi outage', status_name: 'Open' }
      ]),
      getConsolidatedTicketData: vi.fn().mockResolvedValue({
        ticket_id: 'ticket-3',
        ticket_number: 'T-003',
        title: 'WiFi outage',
        description: 'AP reboot required',
        assigned_to: 'user-9',
        due_date: '2026-02-05T08:00:00.000Z'
      }),
    });

    const onPrefill = vi.fn();

    render(
      <TicketIntegrationProvider value={mockCtx}>
        <PrefillFromTicketDialog
          open={true}
          onOpenChange={() => undefined}
          onPrefill={onPrefill}
          users={[]}
        />
      </TicketIntegrationProvider>
    );

    await waitFor(() => expect(mockCtx.getTicketsForList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('ticket-select'), {
      target: { value: 'ticket-3' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prefill' }));

    const payload = onPrefill.mock.calls[0][0];
    expect(payload.prefillData.task_name).toBe('WiFi outage');
    expect(payload.prefillData.description).toBe('AP reboot required');
    expect(payload.prefillData.assigned_to).toBe('user-9');
    expect(payload.prefillData.estimated_hours).toBe(0);
    expect(payload.prefillData.due_date).toBeInstanceOf(Date);
  });
});
