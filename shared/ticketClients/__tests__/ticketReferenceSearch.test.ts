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
    expect(matches('TICKET 2026 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET  2026 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET - 2026 - 0002826', 'TICKET-2026-0002826')).toBe(true);
    expect(matches('TICKET 2026 0002826', 'ALGA-2026-0002826')).toBe(false);
    expect(matches('TICKET-2026-0002826', 'ALGA-2026-0002826')).toBe(false);
  });

  it('does not match a different number or an empty reference', () => {
    expect(matches('ALGA-2026-0009999')).toBe(false);
    expect(matches('Ticket #')).toBe(false);
    expect(matches('   ')).toBe(false);
    expect(ticketNumberMatchesQuery(null, parseTicketSearchQuery('2826'))).toBe(false);
  });
});
