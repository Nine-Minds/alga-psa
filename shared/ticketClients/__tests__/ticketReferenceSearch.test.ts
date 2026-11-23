// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseTicketSearchQuery, ticketNumberMatchesQuery } from '../ticketReferenceSearch';

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

  it('matches a complete labeled email reference exactly, while retaining partial matches', () => {
    const query = parseTicketSearchQuery('Ticket #ALGA-2026-0002826');
    expect(ticketNumberMatchesQuery('ALGA-2026-0002826', query)).toBe(true);
    expect(ticketNumberMatchesQuery('TICKET-ALGA-2026-0002826', query)).toBe(false);
    expect(matches('2826', 'ALGA-2026-0002826')).toBe(true);
  });

  it('does not match a different number or an empty reference', () => {
    expect(matches('ALGA-2026-0009999')).toBe(false);
    expect(matches('Ticket #')).toBe(false);
    expect(matches('   ')).toBe(false);
    expect(ticketNumberMatchesQuery(null, parseTicketSearchQuery('2826'))).toBe(false);
  });
});
