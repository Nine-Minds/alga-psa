import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTicketOrigin, TICKET_ORIGIN_OTHER } from '../ticketOrigin';

describe('ticket origin resolver', () => {
  it('T020: returns stored ticket_origin when present and valid', () => {
    const origin = getTicketOrigin({
      ticket_origin: TICKET_ORIGINS.API,
      source: 'web_app',
      email_metadata: { messageId: 'm-1' },
      entered_by_user_type: 'client',
    });

    expect(origin).toBe(TICKET_ORIGINS.API);
  });

  it('T021: maps null legacy row with email_metadata to inbound_email', () => {
    const origin = getTicketOrigin({
      ticket_origin: null,
      email_metadata: { messageId: 'm-1' },
      source: 'web_app',
      entered_by_user_type: 'internal',
    });

    expect(origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T022: maps null legacy row with creator user_type client to client_portal', () => {
    const origin = getTicketOrigin({
      ticket_origin: null,
      source: null,
      entered_by_user_type: 'client',
    });

    expect(origin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
  });

  it('T023: maps null legacy row with no signal to internal', () => {
    const origin = getTicketOrigin({
      ticket_origin: null,
      source: null,
      entered_by_user_type: null,
      email_metadata: null,
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T024: handles unknown future stored origin values with safe fallback classification', () => {
    const origin = getTicketOrigin({
      ticket_origin: 'ai_agent',
      source: null,
      entered_by_user_type: null,
      email_metadata: null,
    });

    expect(origin).toBe(TICKET_ORIGIN_OTHER);
  });
});
