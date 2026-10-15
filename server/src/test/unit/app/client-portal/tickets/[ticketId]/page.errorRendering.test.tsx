import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const TICKET_ID = '6f1b0e3c-6a4f-4d5e-9b2a-7c8d9e0f1a2b';
const SQL_ERROR_MESSAGE =
  'select "t".* from "tickets" as "t" where "t"."ticket_id" = $1 - invalid input syntax for type uuid: "T-1"';

const getClientTicketDetailsMock = vi.fn();
const getClientPortalTicketStatusesMock = vi.fn();
const getCurrentTenantProductMock = vi.fn();
const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientTicketDetails: getClientTicketDetailsMock,
  getClientPortalTicketStatuses: getClientPortalTicketStatusesMock,
}));

vi.mock('@alga-psa/client-portal/components', () => ({
  TicketDetailsContainer: () => <div id="ticket-details">ticket details</div>,
}));

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({
    t: (key: string, options?: { defaultValue?: string; message?: string }) =>
      (options?.defaultValue ?? key).replace('{{message}}', options?.message ?? ''),
  }),
}));

const { default: TicketPage } = await import('server/src/app/client-portal/tickets/[ticketId]/page');

const render = async () =>
  renderToStaticMarkup(await TicketPage({ params: Promise.resolve({ ticketId: TICKET_ID }) }));

const expectNoServerDetail = (html: string) => {
  expect(html).toContain('Failed to load ticket details');
  expect(html).not.toContain('select');
  expect(html).not.toContain('tickets');
  expect(html).not.toContain('uuid');
  expect(html).not.toContain('at ');
  expect(html).not.toContain('Error:');
};

describe('client portal ticket page error rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantProductMock.mockResolvedValue('psa');
    getClientPortalTicketStatusesMock.mockResolvedValue([]);
  });

  it('renders only the generic message when the ticket action throws, and logs the raw detail', async () => {
    getClientTicketDetailsMock.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    const html = await render();

    expect(html).toContain('id="ticket-error-message"');
    expectNoServerDetail(html);
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[ClientPortal] Failed to fetch ticket details',
      expect.objectContaining({ ticketId: TICKET_ID, error: SQL_ERROR_MESSAGE }),
    );
  });

  it('renders the friendly not-found message for the not-found action error', async () => {
    getClientTicketDetailsMock.mockResolvedValue({
      actionError: 'Ticket not found or access denied',
      messageKey: 'client-portal:errors.tickets.notFoundOrDenied',
    });

    const html = await render();

    expect(html).toContain('id="ticket-error-message"');
    expect(html).toContain('Ticket not found or access denied');
    expect(html).not.toContain('select');
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('renders only the generic message when the statuses action throws, and logs the raw detail', async () => {
    getClientTicketDetailsMock.mockResolvedValue({ ticket_id: TICKET_ID, board_id: 'board-1', status_id: 'status-1' });
    getClientPortalTicketStatusesMock.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    const html = await render();

    expect(html).toContain('id="ticket-error-message"');
    expectNoServerDetail(html);
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[ClientPortal] Failed to fetch ticket details',
      expect.objectContaining({ error: SQL_ERROR_MESSAGE }),
    );
  });

  it('still renders the details when everything succeeds', async () => {
    getClientTicketDetailsMock.mockResolvedValue({ ticket_id: TICKET_ID, board_id: null });

    const html = await render();

    expect(html).toContain('ticket details');
    expect(html).not.toContain('ticket-error-message');
  });
});
