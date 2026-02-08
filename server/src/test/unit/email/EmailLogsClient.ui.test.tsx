/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailLogsClient from 'server/src/app/msp/email-logs/EmailLogsClient';

vi.mock('@alga-psa/email/actions', () => ({
  getEmailLogs: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, id, ...props }: any) => (
    <button data-automation-id={id} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="dialog">{children}</div> : null),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, onRowClick }: any) => (
    <table>
      <tbody>
        {data.map((row: any, idx: number) => (
          <tr key={row.id ?? idx} onClick={() => onRowClick?.(row)}>
            {columns.map((col: any, colIdx: number) => {
              const value = row[col.dataIndex];
              const cell = col.render ? col.render(value, row, idx) : String(value ?? '');
              return <td key={colIdx}>{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import { getEmailLogs } from '@alga-psa/email/actions';

const getEmailLogsMock = vi.mocked(getEmailLogs);

describe('EmailLogsClient', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    getEmailLogsMock.mockReset();
    getEmailLogsMock.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 0,
    } as any);
  });

  it('renders metrics cards', () => {
    render(
      <EmailLogsClient
        initialMetrics={{ total: 10, failed: 2, today: 3, failedRate: 0.2 }}
        initialLogs={{ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }}
      />
    );

    expect(screen.getByText('Total sent')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('Failed rate')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('updates results when status filter changes', async () => {
    const user = userEvent.setup();

    render(
      <EmailLogsClient
        initialMetrics={{ total: 0, failed: 0, today: 0, failedRate: 0 }}
        initialLogs={{ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }}
      />
    );

    await user.selectOptions(screen.getByRole('combobox'), 'failed');

    await waitFor(() => {
      const lastCall = getEmailLogsMock.mock.calls.at(-1)?.[0] as any;
      expect(lastCall.status).toBe('failed');
    });
  });

  it('updates results when date range filter changes', async () => {
    getEmailLogsMock
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 } as any)
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            sent_at: '2026-01-01T00:00:00Z',
            ticket_number: '123',
            to_addresses: ['to@example.com'],
            subject: 'Filtered',
            status: 'sent',
            provider_type: 'test',
            provider_id: 'p',
            message_id: 'm1',
            from_address: 'from@example.com',
            metadata: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      } as any);

    render(
      <EmailLogsClient
        initialMetrics={{ total: 0, failed: 0, today: 0, failedRate: 0 }}
        initialLogs={{ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }}
      />
    );

    const start = document.querySelector('#email-logs-filter-start-date') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-01-01' } });

    await waitFor(() => {
      expect(screen.getByText('Filtered')).toBeTruthy();
    });

    const lastCall = getEmailLogsMock.mock.calls.at(-1)?.[0] as any;
    expect(lastCall.startDate).toBe('2026-01-01');
  });

  it('updates results when recipient search changes', async () => {
    getEmailLogsMock
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 } as any)
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            sent_at: '2026-01-01T00:00:00Z',
            ticket_number: '123',
            to_addresses: ['alice@example.com'],
            subject: 'Recipient filtered',
            status: 'sent',
            provider_type: 'test',
            provider_id: 'p',
            message_id: 'm1',
            from_address: 'from@example.com',
            metadata: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      } as any);

    render(
      <EmailLogsClient
        initialMetrics={{ total: 0, failed: 0, today: 0, failedRate: 0 }}
        initialLogs={{ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search email…'), { target: { value: 'alice' } });

    await waitFor(() => {
      const lastCall = getEmailLogsMock.mock.calls.at(-1)?.[0] as any;
      expect(lastCall.recipientEmail).toBe('alice');
    });

    await waitFor(() => {
      expect(screen.getByText('Recipient filtered')).toBeTruthy();
    });
  });

  it('updates results when ticket filter changes', async () => {
    getEmailLogsMock
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 } as any)
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            sent_at: '2026-01-01T00:00:00Z',
            ticket_number: '123',
            to_addresses: ['to@example.com'],
            subject: 'Ticket filtered',
            status: 'sent',
            provider_type: 'test',
            provider_id: 'p',
            message_id: 'm1',
            from_address: 'from@example.com',
            metadata: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      } as any);

    render(
      <EmailLogsClient
        initialMetrics={{ total: 0, failed: 0, today: 0, failedRate: 0 }}
        initialLogs={{ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Ticket #…'), { target: { value: '123' } });

    await waitFor(() => {
      const lastCall = getEmailLogsMock.mock.calls.at(-1)?.[0] as any;
      expect(lastCall.ticketNumber).toBe('123');
    });

    await waitFor(() => {
      expect(screen.getByText('Ticket filtered')).toBeTruthy();
    });
  });

  it('opens detail dialog when a row is clicked', async () => {
    const user = userEvent.setup();

    getEmailLogsMock.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      data: [
        {
          id: 1,
          sent_at: '2026-01-01T00:00:00Z',
          ticket_number: '123',
          to_addresses: ['to@example.com'],
          subject: 'Hello',
          status: 'sent',
          provider_type: 'test',
          provider_id: 'p',
          message_id: 'm1',
          from_address: 'from@example.com',
          error_message: 'Boom',
          metadata: { ok: true },
        },
      ] as any,
    } as any);

    render(
      <EmailLogsClient
        initialMetrics={{ total: 1, failed: 0, today: 1, failedRate: 0 }}
        initialLogs={{
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
          data: [
            {
              id: 1,
              sent_at: '2026-01-01T00:00:00Z',
              ticket_number: '123',
              to_addresses: ['to@example.com'],
              subject: 'Hello',
              status: 'sent',
              provider_type: 'test',
              provider_id: 'p',
              message_id: 'm1',
              from_address: 'from@example.com',
              error_message: 'Boom',
              metadata: { ok: true },
            },
          ] as any,
        }}
      />
    );

    await screen.findByText('Hello');
    await user.click(screen.getByText('Hello'));

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeTruthy();
    });

    const dialog = screen.getByTestId('dialog');
    expect(within(dialog).getByText('Sent at')).toBeTruthy();
    expect(within(dialog).getByText('Status')).toBeTruthy();
    expect(within(dialog).getByText('Provider')).toBeTruthy();
    expect(within(dialog).getByText('Message ID')).toBeTruthy();
    expect(within(dialog).getByText('To')).toBeTruthy();
    expect(within(dialog).getByText('From')).toBeTruthy();
    expect(within(dialog).getByText('Error')).toBeTruthy();
    expect(within(dialog).getByText('Metadata')).toBeTruthy();

    expect(within(dialog).getByText(/test \(p\)/i)).toBeTruthy();
    expect(within(dialog).getByText('m1')).toBeTruthy();
    expect(within(dialog).getByText('to@example.com')).toBeTruthy();
    expect(within(dialog).getByText('from@example.com')).toBeTruthy();
    expect(within(dialog).getByText('Boom')).toBeTruthy();
    expect(within(dialog).getByText(/"ok": true/)).toBeTruthy();
  });
});
