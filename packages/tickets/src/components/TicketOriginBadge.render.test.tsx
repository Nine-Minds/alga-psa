import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TICKET_ORIGINS } from '@alga-psa/types';
import TicketOriginBadge from './TicketOriginBadge';

describe('TicketOriginBadge render contract', () => {
  it('T040: renders Created Internally label and data attribute for internal', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.INTERNAL} />
    );

    expect(html).toContain('Created Internally');
    expect(html).toContain('data-ticket-origin="internal"');
  });

  it('T041: renders Created via Client Portal label and data attribute for client_portal', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.CLIENT_PORTAL} />
    );

    expect(html).toContain('Created via Client Portal');
    expect(html).toContain('data-ticket-origin="client_portal"');
  });

  it('T042: renders Created via Inbound Email label and data attribute for inbound_email', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.INBOUND_EMAIL} />
    );

    expect(html).toContain('Created via Inbound Email');
    expect(html).toContain('data-ticket-origin="inbound_email"');
  });

  it('T043: renders Created via API label and data attribute for api', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={TICKET_ORIGINS.API} />
    );

    expect(html).toContain('Created via API');
    expect(html).toContain('data-ticket-origin="api"');
  });

  it('T044: renders safe fallback label for unknown future origin value', () => {
    const html = renderToStaticMarkup(
      <TicketOriginBadge origin={'ai_agent'} />
    );

    expect(html).toContain('Created via Other');
    expect(html).toContain('data-ticket-origin="other"');
  });
});
