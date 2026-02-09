import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TICKET_ORIGINS } from '@alga-psa/types';
import TicketOriginBadge from '../../components/TicketOriginBadge';
import { getTicketOrigin } from '../ticketOrigin';

const labels = {
  internal: 'Created Internally',
  clientPortal: 'Created via Client Portal',
  inboundEmail: 'Created via Inbound Email',
};

function renderBadgeForTicket(ticket: Record<string, unknown>): string {
  const origin = getTicketOrigin(ticket as any);

  return renderToStaticMarkup(
    <TicketOriginBadge origin={origin} labels={labels} />
  );
}

describe('ticket origin flow sanity', () => {
  it('T080: end-to-end sanity: new MSP-created ticket displays internal origin badge', () => {
    const html = renderBadgeForTicket({
      source: 'web_app',
      email_metadata: null,
      entered_by_user_type: 'internal',
    });

    expect(getTicketOrigin({ source: 'web_app' })).toBe(TICKET_ORIGINS.INTERNAL);
    expect(html).toContain('Created Internally');
    expect(html).toContain('data-ticket-origin="internal"');
  });

  it('T081: end-to-end sanity: new client-portal-created ticket displays client_portal badge', () => {
    const html = renderBadgeForTicket({
      source: 'client_portal',
      email_metadata: null,
      entered_by_user_type: 'client',
    });

    expect(getTicketOrigin({ source: 'client_portal' })).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
    expect(html).toContain('Created via Client Portal');
    expect(html).toContain('data-ticket-origin="client_portal"');
  });

  it('T082: end-to-end sanity: new inbound-email-created ticket displays inbound_email badge', () => {
    const html = renderBadgeForTicket({
      source: 'email',
      email_metadata: { messageId: 'm-1' },
      entered_by_user_type: 'client',
    });

    expect(
      getTicketOrigin({
        source: 'email',
        email_metadata: { messageId: 'm-1' },
      })
    ).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
    expect(html).toContain('Created via Inbound Email');
    expect(html).toContain('data-ticket-origin="inbound_email"');
  });
});
