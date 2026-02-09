import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTicketOrigin } from '../ticketOrigin';

describe('ticket origin resolver', () => {
  it('T001: returns inbound_email when ticket.email_metadata is present', () => {
    const origin = getTicketOrigin({
      email_metadata: { messageId: 'msg-1' },
      source: 'web_app',
      entered_by_user_type: 'internal',
    });

    expect(origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T002: keeps inbound_email precedence even when creator is a client user', () => {
    const origin = getTicketOrigin({
      email_metadata: { provider: 'google' },
      entered_by_user_type: 'client',
      source: 'client_portal',
    });

    expect(origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T003: maps explicit source=client_portal to client_portal origin', () => {
    const origin = getTicketOrigin({
      source: 'client_portal',
      entered_by_user_type: 'internal',
    });

    expect(origin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
  });

  it('T004: maps explicit source=email to inbound_email origin', () => {
    const origin = getTicketOrigin({
      source: 'email',
      entered_by_user_type: 'internal',
    });

    expect(origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T005: maps explicit source=web_app to internal origin', () => {
    const origin = getTicketOrigin({
      source: 'web_app',
      entered_by_user_type: 'client',
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T006: maps explicit source=api to internal origin', () => {
    const origin = getTicketOrigin({
      source: 'api',
      entered_by_user_type: 'client',
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T007: returns client_portal when creator user_type is client and no email signal exists', () => {
    const origin = getTicketOrigin({
      source: null,
      entered_by_user_type: 'client',
    });

    expect(origin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
  });

  it('T008: returns internal when creator user_type is internal and no email signal exists', () => {
    const origin = getTicketOrigin({
      source: null,
      entered_by_user_type: 'internal',
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T009: returns internal when creator information is missing', () => {
    const origin = getTicketOrigin({
      source: null,
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T010: handles unknown source values safely and falls back to internal', () => {
    const origin = getTicketOrigin({
      source: 'some_future_source',
      entered_by_user_type: null,
    });

    expect(origin).toBe(TICKET_ORIGINS.INTERNAL);
  });
});
