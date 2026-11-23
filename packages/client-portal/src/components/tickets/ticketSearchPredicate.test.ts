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
    const p = buildTicketSearchPredicate(q, [ticket, other]);
    expect(p(ticket)).toBe(true);
    expect(p(other)).toBe(false);
  });

  it('applies no filter for empty or whitespace queries', () => {
    expect(buildTicketSearchPredicate('', [other])(other)).toBe(true);
    expect(buildTicketSearchPredicate('   ', [other])(other)).toBe(true);
  });

  it('finds a row by reference when the portal payload lacks status and priority', () => {
    const rows = [
      { title: ticket.title, ticket_number: ticket.ticket_number, status_name: null },
      { title: other.title, ticket_number: other.ticket_number, priority_name: null },
    ];
    const matches = buildTicketSearchPredicate('Ticket #ALGA-2026-0002826', rows);
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
    const rows = [ticketPrefixNumber, algaNumber];
    const results = rows.filter(buildTicketSearchPredicate(query, rows));
    expect(results.map(({ ticket_number }) => ticket_number)).toEqual(expectedNumbers);
  });

  it.each([
    'TICKET ALGA 2026 0002826',
    'TICKET-ALGA-2026-0002826',
    'TICKETALGA20260002826',
  ])('matches a loaded literal TICKET-prefixed number for %j', (query) => {
    const rows = [ticketAlgaNumber];
    const results = rows.filter(buildTicketSearchPredicate(query, rows));
    expect(results.map(({ ticket_number }) => ticket_number)).toEqual(['TICKET-ALGA-2026-0002826']);
  });

  it.each([
    'TICKET -ALGA-2026-0002826',
    'TICKET- ALGA-2026-0002826',
    'TICKET - ALGA-2026-0002826',
  ])('preserves separators around the literal TICKET prefix for %j', (query) => {
    const rows = [ticketAlgaNumber];
    const results = rows.filter(buildTicketSearchPredicate(query, rows));
    expect(results.map(({ ticket_number }) => ticket_number)).toEqual(['TICKET-ALGA-2026-0002826']);
  });

  it('returns only the exact ALGA number for a full labeled reference and both numbers for its suffix', () => {
    const overlappingNumbers = [
      { title: 'No matching title', ticket_number: 'ALGA-2026-0002826', status_name: 'No matching status', priority_name: 'No matching priority' },
      { title: 'No matching title', ticket_number: 'TICKET-ALGA-2026-0002826', status_name: 'No matching status', priority_name: 'No matching priority' },
    ];
    const run = (query: string) => overlappingNumbers
      .filter(buildTicketSearchPredicate(query, overlappingNumbers))
      .map(({ ticket_number }) => ticket_number);

    expect(run('Ticket #ALGA-2026-0002826')).toEqual(['ALGA-2026-0002826']);
    expect(run('#ALGA-2026-0002826')).toEqual(['ALGA-2026-0002826']);
    expect(run('Ticket #ALGA-2026')).toEqual(['ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826']);
    expect(run('2826')).toEqual(['ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826']);
  });

  it('prefers an exact literal TICKET number over the label interpretation when both rows are loaded', () => {
    const rows = [algaNumber, ticketAlgaNumber];
    const results = rows
      .filter(buildTicketSearchPredicate('TICKET ALGA 2026 0002826', rows))
      .map(({ ticket_number }) => ticket_number);
    expect(results).toEqual(['TICKET-ALGA-2026-0002826']);
  });
});
