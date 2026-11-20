// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboundQuarantineQueue } from './InboundQuarantineQueue';

const { listInboundQuarantineMock, dismissInboundQuarantineMock } = vi.hoisted(() => ({
  listInboundQuarantineMock: vi.fn(),
  dismissInboundQuarantineMock: vi.fn(),
}));

vi.mock('../../../actions/email-actions/inboundQuarantineActions', () => ({
  listInboundQuarantine: listInboundQuarantineMock,
  dismissInboundQuarantine: dismissInboundQuarantineMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
  useFormatters: () => ({
    formatDate: (value: string) => `formatted:${value}`,
  }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id }: any) => <div id={id} />,
}));

// DataTable stays real on purpose: the column definitions are what this test exercises.

const ROW_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    providerId: 'provider-1',
    mailbox: 'support@msp.example',
    sender: 'outsider@elsewhere.example',
    subject: '',
    reason: 'sender_not_on_ticket',
    ticketId: TICKET_ID,
    ticketNumber: 'T-1042',
    receivedAt: '2026-11-14T10:00:00.000Z',
    quarantinedAt: '2026-11-14T10:00:01.000Z',
    status: 'open',
    dismissedAt: null,
    ...overrides,
  };
}

describe('InboundQuarantineQueue', () => {
  beforeEach(() => {
    listInboundQuarantineMock.mockReset();
    dismissInboundQuarantineMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders each column through its render function: ticket number link, subject fallback, date, dismiss', async () => {
    listInboundQuarantineMock.mockResolvedValue({
      rows: [makeRow()],
      total: 1,
      mailboxes: [{ providerId: 'provider-1', mailbox: 'support@msp.example' }],
    });

    render(<InboundQuarantineQueue />);

    await waitFor(() => expect(screen.getAllByText('outsider@elsewhere.example').length).toBeGreaterThan(0));

    const ticketLink = screen.getAllByText('T-1042').find((el) => el.tagName === 'A');
    expect(ticketLink).toBeDefined();
    expect(ticketLink!.getAttribute('href')).toBe(`/msp/tickets/${TICKET_ID}`);
    // The matched ticket shows as its number, never the raw id.
    expect(document.body.textContent).not.toContain(TICKET_ID);

    expect(screen.getAllByText('(no subject)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('formatted:2026-11-14T10:00:00.000Z').length).toBeGreaterThan(0);

    dismissInboundQuarantineMock.mockResolvedValue({ success: true });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    await waitFor(() => expect(dismissInboundQuarantineMock).toHaveBeenCalledWith(ROW_ID));
  });

  it('omits the dismiss action and ticket link for dismissed rows without a ticket', async () => {
    listInboundQuarantineMock.mockResolvedValue({
      rows: [makeRow({ status: 'dismissed', ticketId: null, ticketNumber: null, subject: 'Hello' })],
      total: 1,
      mailboxes: [],
    });

    render(<InboundQuarantineQueue initialStatus="dismissed" />);

    await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('button', { name: 'Dismiss' })).toHaveLength(0);
    expect(document.querySelector('a[href^="/msp/tickets/"]')).toBeNull();
  });
});
