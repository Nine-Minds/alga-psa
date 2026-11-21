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
});
