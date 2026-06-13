/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketEmailNotifications from '@alga-psa/tickets/components/ticket/TicketEmailNotifications';

vi.mock('@alga-psa/email/actions', () => ({
  getEmailLogsForTicket: vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-automation-id': id }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, id, ...props }: any) => (
    <button data-automation-id={id} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <table data-automation-id={id}>
      <tbody>
        {data.map((row: any, rowIndex: number) => (
          <tr key={row.id ?? rowIndex}>
            {columns.map((col: any, colIndex: number) => {
              const value = row[col.dataIndex];
              const cell = col.render ? col.render(value, row, rowIndex) : String(value ?? '');
              return <td key={colIndex}>{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import { getEmailLogsForTicket } from '@alga-psa/email/actions';

const getEmailLogsForTicketMock = vi.mocked(getEmailLogsForTicket);

const TOGGLE_SELECTOR = '[data-automation-id="ticket-email-notifications-toggle"]';

function isCardExpanded(): boolean {
  const toggle = document.querySelector(TOGGLE_SELECTOR);
  return !!toggle?.querySelector('.lucide-chevron-down');
}

/**
 * The card is rendered in a collapsible ContentCard that also auto-expands when
 * its `count` (logs.length) transitions from 0 to >0 after the async fetch
 * resolves. That auto-expand races with a manual toggle click, so instead of
 * a single click we poll: if the card is collapsed, click the toggle, and keep
 * checking until it reports expanded (chevron-down). This is deterministic for
 * both the empty/loading cases (manual expand) and the populated cases (where
 * either the manual click or the auto-expand wins).
 */
async function expandCard(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(async () => {
    if (!isCardExpanded()) {
      const toggle = document.querySelector(TOGGLE_SELECTOR) as HTMLButtonElement;
      if (toggle) {
        await user.click(toggle);
      }
    }
    expect(isCardExpanded()).toBe(true);
  });
}

describe('TicketEmailNotifications', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    getEmailLogsForTicketMock.mockReset();
  });

  it('renders without errors', () => {
    getEmailLogsForTicketMock.mockResolvedValue([]);
    render(<TicketEmailNotifications ticketId="ticket-1" />);
    expect(screen.getByText('Email Notifications')).toBeTruthy();
  });

  it('is collapsed by default and expands on click', async () => {
    const user = userEvent.setup();
    getEmailLogsForTicketMock.mockResolvedValue([]);

    render(<TicketEmailNotifications ticketId="ticket-1" />);

    expect(screen.queryByText('No email notifications found.')).toBeNull();

    await expandCard(user);
    await waitFor(() => {
      expect(screen.getByText('No email notifications found.')).toBeTruthy();
    });
  });

  it('shows loading state while fetching', async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: any[]) => void;
    const pending = new Promise<any[]>((resolve) => {
      resolveFetch = resolve;
    });
    // @ts-expect-error resolveFetch is assigned synchronously above
    getEmailLogsForTicketMock.mockReturnValue(pending);

    render(<TicketEmailNotifications ticketId="ticket-1" />);

    await expandCard(user);
    expect(screen.getByText('Loading…')).toBeTruthy();

    resolveFetch!([]);
    await waitFor(() => {
      expect(screen.getByText('No email notifications found.')).toBeTruthy();
    });
  });

  it('displays timestamp, recipient, subject, and status for each log entry', async () => {
    const user = userEvent.setup();
    getEmailLogsForTicketMock.mockResolvedValue([
      {
        id: 1,
        sent_at: '2026-01-01T12:00:00Z',
        to_addresses: ['to@example.com'],
        subject: 'Hello',
        status: 'sent',
        error_message: null,
      } as any,
    ]);

    render(<TicketEmailNotifications ticketId="ticket-1" />);

    await expandCard(user);

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy();
    });

    expect(screen.getByText('to@example.com')).toBeTruthy();
    const statusLabel = screen.getByText(/^sent$/i);
    expect(statusLabel.parentElement?.querySelector('.bg-emerald-500')).toBeTruthy();
    // Timestamp formatting is locale-dependent; assert we render a value that includes the year.
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  it('shows error message for failed notifications', async () => {
    const user = userEvent.setup();
    getEmailLogsForTicketMock.mockResolvedValue([
      {
        id: 1,
        sent_at: '2026-01-01T12:00:00Z',
        to_addresses: ['to@example.com'],
        subject: 'Hello',
        status: 'failed',
        error_message: 'Boom',
      } as any,
    ]);

    render(<TicketEmailNotifications ticketId="ticket-1" />);
    await expandCard(user);

    await waitFor(() => {
      expect(screen.getByText('Boom')).toBeTruthy();
    });

    const statusLabel = screen.getByText(/^failed$/i);
    expect(statusLabel.parentElement?.querySelector('.bg-red-500')).toBeTruthy();
  });

  it('shows maximum 20 entries initially with Load more when more exist', async () => {
    const user = userEvent.setup();
    const logs = Array.from({ length: 25 }, (_, idx) => ({
      id: idx + 1,
      sent_at: '2026-01-01T12:00:00Z',
      to_addresses: [`user${idx}@example.com`],
      subject: `S${idx}`,
      status: 'sent',
      error_message: null,
    })) as any[];

    getEmailLogsForTicketMock.mockResolvedValueOnce(logs.slice(0, 21)); // limit+1

    render(<TicketEmailNotifications ticketId="ticket-1" />);
    await expandCard(user);

    await waitFor(() => {
      expect(screen.getByText('S0')).toBeTruthy();
    });

    // Our DataTable mock renders one <tr> per item.
    const rows = screen.getByRole('table').querySelectorAll('tr');
    expect(rows.length).toBe(20);

    expect(screen.getByRole('button', { name: /load more/i })).toBeTruthy();
  });

  it('Load more fetches additional entries', async () => {
    const user = userEvent.setup();
    const logs = Array.from({ length: 25 }, (_, idx) => ({
      id: idx + 1,
      sent_at: '2026-01-01T12:00:00Z',
      to_addresses: [`user${idx}@example.com`],
      subject: `S${idx}`,
      status: 'sent',
      error_message: null,
    })) as any[];

    getEmailLogsForTicketMock
      .mockResolvedValueOnce(logs.slice(0, 21)) // initial fetch (limit+1)
      .mockResolvedValueOnce(logs); // after load more (limit+1 big enough)

    render(<TicketEmailNotifications ticketId="ticket-1" />);
    await expandCard(user);

    await waitFor(() => {
      expect(screen.getByText('S0')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(screen.getByText('S24')).toBeTruthy();
    });

    const rows = screen.getByRole('table').querySelectorAll('tr');
    expect(rows.length).toBe(25);
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });
});
