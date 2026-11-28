// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseTicketSearchQuery, resolveTicketNumberMatches, ticketNumberMatchesQuery } from '../ticketReferenceSearch';

const NUMBER = 'ALGA-2026-0002826';
const matches = (q: string, n: string = NUMBER) => ticketNumberMatchesQuery(n, parseTicketSearchQuery(q));

describe('ticketReferenceSearch', () => {
  it.each([
    'ALGA-2026-0002826',
    ' #ALGA-2026-0002826 ',
    'Ticket #ALGA-2026-0002826',
    'Ticket ALGA-2026-0002826',
    'ticket# alga-2026-0002826',
    'alga 2026 0002826',
    'alga20260002826',
    '2826',
  ])('matches %j', (q) => {
    expect(matches(q)).toBe(true);
  });

  it('only trims plain title text', () => {
    const parsed = parseTicketSearchQuery('  Printer broken ');
    expect(parsed.text).toBe('Printer broken');
  });

  it('preserves Ticket when it is part of the identifier', () => {
    expect(matches('#TICKET-2026-0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET-ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826')).toBe(true);
    expect(matches('TICKETALGA20260002826', 'TICKET-ALGA-2026-0002826')).toBe(true);
    expect(matches('TICKET 2026 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET  2026 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET - 2026 - 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET 2026 0002826', 'ALGA-2026-0002826')).toBe(false);
    expect(matches('TICKET-2026-0002826', 'ALGA-2026-0002826')).toBe(false);
  });

  it('keeps the literal TICKET prefix alongside the email-label interpretation', () => {
    const query = parseTicketSearchQuery('TICKET ALGA 2026 0002826');
    expect(query.literalReference).toBe('ticketalga20260002826');
    expect(ticketNumberMatchesQuery('TICKET-ALGA-2026-0002826', query)).toBe(true);
    expect(matches('Ticket ALGA-2026-0002826', 'ALGA-2026-0002826')).toBe(true);
  });

  it('resolves exact labeled references before partial matches across loaded numbers', () => {
    const query = parseTicketSearchQuery('Ticket #ALGA-2026-0002826');
    const numbers = ['ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826'];
    expect([...resolveTicketNumberMatches(numbers, query)]).toEqual(['alga20260002826']);
    expect(parseTicketSearchQuery('#ALGA-2026-0002826').isExplicitLabel).toBe(true);
    expect([...resolveTicketNumberMatches(numbers, parseTicketSearchQuery('#ALGA-2026-0002826'))]).toEqual(['alga20260002826']);
    expect([...resolveTicketNumberMatches(numbers, parseTicketSearchQuery('Ticket #ALGA-2026'))]).toEqual([
      'alga20260002826',
      'ticketalga20260002826',
    ]);
    expect([...resolveTicketNumberMatches(numbers, parseTicketSearchQuery('2826'))]).toEqual([
      'alga20260002826',
      'ticketalga20260002826',
    ]);
  });

  it('does not let a complete email reference fall through to a different identifier substring', () => {
    for (const queryText of [
      'Ticket #ALGA-2026-0002826',
      'Ticket #ALGA 2026 0002826',
      'Ticket #ALGA20260002826',
    ]) {
      const query = parseTicketSearchQuery(queryText);
      expect([...resolveTicketNumberMatches(['TICKET-ALGA-2026-0002826'], query)]).toEqual([]);
      expect(ticketNumberMatchesQuery('TICKET-ALGA-2026-0002826', query)).toBe(false);
    }
  });

  it('resolves explicit references against loaded numbers across labels and separators', () => {
    for (const queryText of ['#ALGA-2026-0002826', 'Ticket #ALGA-2026-0002826']) {
      expect([...resolveTicketNumberMatches(['TICKET-ALGA-2026-0002826'], parseTicketSearchQuery(queryText))]).toEqual([]);
    }
    for (const queryText of ['Ticket #TICKET-ALGA-2026-0002826', 'Ticket #TICKETALGA20260002826']) {
      expect([...resolveTicketNumberMatches(['OLD-TICKET-ALGA-2026-0002826'], parseTicketSearchQuery(queryText))]).toEqual([]);
    }
    for (const queryText of ['Ticket #ALGA-2026-0', 'Ticket #ALGA20260']) {
      expect([...resolveTicketNumberMatches(['ALGA-2026-0002826'], parseTicketSearchQuery(queryText))]).toEqual([
        'alga20260002826',
      ]);
    }
  });

  it('treats a leading hash as introducing an identifier that can begin with TICKET', () => {
    const query = parseTicketSearchQuery('#TICKET ALGA 2026 0002826');
    expect([...resolveTicketNumberMatches(['ALGA-2026-0002826'], query)]).toEqual([]);
    expect([...resolveTicketNumberMatches(['ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826'], query)]).toEqual([
      'ticketalga20260002826',
    ]);
    expect(ticketNumberMatchesQuery('ALGA-2026-0002826', query)).toBe(false);
    expect(ticketNumberMatchesQuery('TICKET-ALGA-2026-0002826', query)).toBe(true);
  });

  it('strips a Ticket label before a short numeric reference', () => {
    expect(matches('Ticket 2826')).toBe(true);
    expect(matches('Ticket #2826')).toBe(true);
  });

  it('supports whitespace, case, and separator-insensitive forms with identical helper matching', () => {
    for (const queryText of ['  ticket #alga-2026-0002826  ', 'alga 2026 0002826', 'ALGA20260002826']) {
      const query = parseTicketSearchQuery(queryText);
      expect(ticketNumberMatchesQuery(NUMBER, query)).toBe(true);
      expect([...resolveTicketNumberMatches([NUMBER], query)]).toEqual(['alga20260002826']);
    }
  });

  it('prefers an exact literal TICKET identifier before the email-label interpretation', () => {
    const numbers = ['ALGA-2026-0002826', 'TICKET-ALGA-2026-0002826'];
    const query = parseTicketSearchQuery('TICKET ALGA 2026 0002826');
    expect([...resolveTicketNumberMatches(numbers, query)]).toEqual(['ticketalga20260002826']);
  });

  it('does not match a different number or an empty reference', () => {
    expect(matches('ALGA-2026-0009999')).toBe(false);
    expect(matches('Ticket #')).toBe(false);
    expect(matches('   ')).toBe(false);
    expect(ticketNumberMatchesQuery(null, parseTicketSearchQuery('2826'))).toBe(false);
  });
});
