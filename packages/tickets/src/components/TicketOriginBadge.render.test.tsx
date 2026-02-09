import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TICKET_ORIGINS } from '@alga-psa/types';
import TicketOriginBadge from './TicketOriginBadge';

describe('TicketOriginBadge render contract', () => {
  it('T030: renders internal variant with expected label and data attribute', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.INTERNAL} />
    );

    expect(html).toContain('Created Internally');
    expect(html).toContain('data-ticket-origin="internal"');
  });

  it('T031: renders client_portal variant with expected label and data attribute', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.CLIENT_PORTAL} />
    );

    expect(html).toContain('Created via Client Portal');
    expect(html).toContain('data-ticket-origin="client_portal"');
  });

  it('T032: renders inbound_email variant with expected label and data attribute', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.INBOUND_EMAIL} />
    );

    expect(html).toContain('Created via Inbound Email');
    expect(html).toContain('data-ticket-origin="inbound_email"');
  });

  it('T033: supports size/className props used by both TicketDetails views', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge
        origin={TICKET_ORIGINS.INTERNAL}
        size="md"
        className="origin-badge-custom"
      />
    );

    expect(html).toContain('origin-badge-custom');
    expect(html).toContain('text-sm');
  });
});
