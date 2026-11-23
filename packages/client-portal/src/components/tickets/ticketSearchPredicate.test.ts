// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildTicketSearchPredicate } from './ticketSearchPredicate';

const ticket = {
  title: 'Printer offline on floor 2',
  ticket_number: 'ALGA-2026-0002826',
  status_name: 'Open',
  priority_name: 'High',
};
const other = { ...ticket, title: 'VPN', ticket_number: 'ALGA-2026-0000001', status_name: 'Closed', priority_name: 'Low' };
const ticketPrefixNumber = {
  title: 'No matching title',
  ticket_number: 'TICKET-2026-0002826',
  status_name: 'No matching status',
  priority_name: 'No matching priority',
};
const algaNumber = {
  ...ticketPrefixNumber,
  ticket_number: 'ALGA-2026-0002826',
};
const ticketAlgaNumber = {
  ...ticketPrefixNumber,
  ticket_number: 'TICKET-ALGA-2026-0002826',
};

describe('buildTicketSearchPredicate', () => {
  it.each([
    'ALGA-2026-0002826',
    '#ALGA-2026-0002826',
    ' #ALGA-2026-0002826 ',
    'Ticket #ALGA-2026-0002826',
    'alga20260002826',
    '2826',
    ' printer offline ',
    ' OPEN ',
    ' HIGH ',
  ])('finds the ticket for %j and not the other', (q) => {
    const p = buildTicketSearchPredicate(q);
    expect(p(ticket)).toBe(true);
    expect(p(other)).toBe(false);
  });

  it('applies no filter for empty or whitespace queries', () => {
    expect(buildTicketSearchPredicate('')(other)).toBe(true);
    expect(buildTicketSearchPredicate('   ')(other)).toBe(true);
  });

  it('finds a row by reference when the portal payload lacks status and priority', () => {
    const matches = buildTicketSearchPredicate('Ticket #ALGA-2026-0002826');
    expect(matches({ title: ticket.title, ticket_number: ticket.ticket_number, status_name: null })).toBe(true);
    expect(matches({ title: other.title, ticket_number: other.ticket_number, priority_name: null })).toBe(false);
  });

  it.each([
    ['TICKET 2026 0002826', ['TICKET-2026-0002826']],
    ['TICKET  2026 0002826', ['TICKET-2026-0002826']],
    ['TICKET - 2026 - 0002826', ['TICKET-2026-0002826']],
    ['TICKET-2026-0002826', ['TICKET-2026-0002826']],
    ['TICKET20260002826', ['TICKET-2026-0002826']],
    ['Ticket #ALGA-2026-0002826', ['ALGA-2026-0002826']],
    ['2826', ['TICKET-2026-0002826', 'ALGA-2026-0002826']],
  ])('returns exact ticket numbers for %j', (query, expectedNumbers) => {
    const results = [ticketPrefixNumber, algaNumber].filter(buildTicketSearchPredicate(query));
    expect(results.map(({ ticket_number }) => ticket_number)).toEqual(expectedNumbers);
  });

  it.each([
    'TICKET-ALGA-2026-0002826',
    'TICKET -ALGA-2026-0002826',
    'TICKET- ALGA-2026-0002826',
    'TICKET - ALGA-2026-0002826',
    'TICKETALGA20260002826',
  ])('preserves the hyphenated TICKET prefix for %j', (query) => {
    const results = [ticketAlgaNumber, algaNumber].filter(buildTicketSearchPredicate(query));
    expect(results.map(({ ticket_number }) => ticket_number)).toEqual(['TICKET-ALGA-2026-0002826']);
  });
});
