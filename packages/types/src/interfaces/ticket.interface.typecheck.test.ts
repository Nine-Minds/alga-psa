import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS, type TicketOrigin } from './ticket.interfaces';

type ExpectedTicketOrigin =
  | 'internal'
  | 'client_portal'
  | 'inbound_email'
  | 'api';

type TicketOriginIsSubsetOfExpected =
  TicketOrigin extends ExpectedTicketOrigin ? true : false;
type ExpectedIsSubsetOfTicketOrigin =
  ExpectedTicketOrigin extends TicketOrigin ? true : false;

const ticketOriginContractChecks = {
  ticketOriginIsSubsetOfExpected: true as TicketOriginIsSubsetOfExpected,
  expectedIsSubsetOfTicketOrigin: true as ExpectedIsSubsetOfTicketOrigin,
};

describe('TicketOrigin typing contract', () => {
  it('T006: type-level check accepts internal/client_portal/inbound_email/api and rejects invalid values', () => {
    const validOrigins: TicketOrigin[] = [
      TICKET_ORIGINS.INTERNAL,
      TICKET_ORIGINS.CLIENT_PORTAL,
      TICKET_ORIGINS.INBOUND_EMAIL,
      TICKET_ORIGINS.API,
    ];
    // @ts-expect-error invalid origin must not be assignable to TicketOrigin
    const invalidOrigin: TicketOrigin = 'ai_agent';

    expect(validOrigins).toEqual([
      'internal',
      'client_portal',
      'inbound_email',
      'api',
    ]);
    expect(invalidOrigin).toBe('ai_agent');
    expect(ticketOriginContractChecks.ticketOriginIsSubsetOfExpected).toBe(true);
    expect(ticketOriginContractChecks.expectedIsSubsetOfTicketOrigin).toBe(true);
  });
});
