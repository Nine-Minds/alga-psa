import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS, type TicketOrigin } from './ticket.interfaces';

type ExpectedTicketOrigin =
  | 'internal'
  | 'client_portal'
  | 'inbound_email';

type TicketOriginIsSubsetOfExpected =
  TicketOrigin extends ExpectedTicketOrigin ? true : false;
type ExpectedIsSubsetOfTicketOrigin =
  ExpectedTicketOrigin extends TicketOrigin ? true : false;

const ticketOriginContractChecks = {
  ticketOriginIsSubsetOfExpected: true as TicketOriginIsSubsetOfExpected,
  expectedIsSubsetOfTicketOrigin: true as ExpectedIsSubsetOfTicketOrigin,
};

describe('TicketOrigin typing contract', () => {
  it('T011: type-level check enforces TicketOrigin union values only', () => {
    const validOrigins: TicketOrigin[] = [
      TICKET_ORIGINS.INTERNAL,
      TICKET_ORIGINS.CLIENT_PORTAL,
      TICKET_ORIGINS.INBOUND_EMAIL,
    ];

    expect(validOrigins).toEqual([
      'internal',
      'client_portal',
      'inbound_email',
    ]);
    expect(ticketOriginContractChecks.ticketOriginIsSubsetOfExpected).toBe(true);
    expect(ticketOriginContractChecks.expectedIsSubsetOfTicketOrigin).toBe(true);
  });
});
