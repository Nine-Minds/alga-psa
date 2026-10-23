/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const { searchWorkflowTicketsMock, getTicketByIdMock } = vi.hoisted(() => ({
  searchWorkflowTicketsMock: vi.fn(),
  getTicketByIdMock: vi.fn(),
}));

vi.mock('../workflowTicketPickerSearch', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../workflowTicketPickerSearch');
  return { ...actual, searchWorkflowTickets: searchWorkflowTicketsMock };
});

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: getTicketByIdMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn().mockResolvedValue([]),
  getContactsByClient: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/integrations/actions', () => ({
  getAvailableStatuses: vi.fn().mockResolvedValue({ statuses: [] }),
  getTicketFieldOptions: vi.fn().mockResolvedValue({ options: {} }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic: vi.fn().mockResolvedValue([]),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
  isTeamActionError: () => false,
}));
vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProjectsWithPhases: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/projects/actions/projectTaskActions', () => ({
  getProjectTaskData: vi.fn().mockResolvedValue({ tasks: [] }),
}));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getTicketsForList: vi.fn(),
}));

import { WorkflowActionInputFixedPicker } from '../WorkflowActionInputFixedPicker';

const ticketField = {
  name: 'ticketId',
  editor: {
    kind: 'picker' as const,
    picker: { resource: 'ticket' },
    fixedValueHint: 'Search tickets by number or title',
  },
};

describe('WorkflowActionInputFixedPicker ticket picker', () => {
  afterEach(() => {
    cleanup();
    searchWorkflowTicketsMock.mockReset();
    getTicketByIdMock.mockReset();
  });

  it('is one searchable picker: opening lists tickets, typing searches, choosing commits the id', async () => {
    searchWorkflowTicketsMock.mockImplementation(async ({ search }: { search: string }) => ({
      options: search
        ? [{ value: 'ticket-1122', label: 'TIC001122 · Server down', secondaryLabel: 'Acme · Urgent Matters' }]
        : [{ value: 'ticket-1', label: 'TIC000001 · Recent' }],
      total: 1,
    }));
    const onChange = vi.fn();

    render(
      <WorkflowActionInputFixedPicker
        idPrefix="run-ticket"
        field={ticketField}
        value={null}
        onChange={onChange}
        rootInputMapping={{}}
      />
    );

    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('TIC000001 · Recent')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search tickets by number or title'), {
      target: { value: '1122' },
    });
    const option = await screen.findByText('TIC001122 · Server down');
    expect(searchWorkflowTicketsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: '1122' }));

    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('ticket-1122');
  });

  it('shows the ticket number and title for a value set earlier', async () => {
    getTicketByIdMock.mockResolvedValue({ ticket_id: 'ticket-9', ticket_number: 'TIC000009', title: 'Printer jam' });

    render(
      <WorkflowActionInputFixedPicker
        idPrefix="run-ticket"
        field={ticketField}
        value="ticket-9"
        onChange={vi.fn()}
        rootInputMapping={{}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('TIC000009 · Printer jam'));
  });
});
