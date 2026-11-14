import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTicketResponsibility, registerTicketResponsibilityProvider } from './ticketResponsibility';
import { ticketResponsibilityVisibility } from './ticketResponsibilityVisibility';
import { getSeatResponsibilityFilter, setSeatResponsibilityFilter } from './ticketSeatResponsibilityFilter';

const state = (responsibility: 'client_it' | 'msp') => ({ responsibility, revision: 0, technicians: [] });

describe('ticket screen responsibility visibility', () => {
  it('shows neither the chip nor the action when the server sent no state (other clients, flag or capability off)', () => {
    expect(ticketResponsibilityVisibility(null)).toEqual({ chip: false, handoff: false });
    expect(ticketResponsibilityVisibility(undefined)).toEqual({ chip: false, handoff: false });
  });
  it('shows the chip and the action while the MSP holds the ticket', () => {
    expect(ticketResponsibilityVisibility(state('msp'))).toEqual({ chip: true, handoff: true });
  });
  it('shows the chip only once the ticket is with client IT: handing back is the technician\'s move', () => {
    expect(ticketResponsibilityVisibility(state('client_it'))).toEqual({ chip: true, handoff: false });
  });
});

describe('ticket list responsibility provider seam', () => {
  // The registry is process-global: start from none, whatever else registered at import.
  beforeEach(() => { (globalThis as Record<symbol, Map<string, unknown>>)[Symbol.for('alga.tickets.responsibilityProviders')]?.clear(); });
  it('offers nothing when no provider is registered', async () => {
    expect(await resolveTicketResponsibility({ tenant: 't', subject: { resolverFacts: {} } as never })).toBeNull();
  });
  it('offers the first provider that offers the reader', async () => {
    const never = { offered: () => false, read: async () => new Map(), load: async () => null, handToClientIt: async () => state('client_it') };
    const yes = { ...never, offered: async () => true };
    registerTicketResponsibilityProvider('never', never);
    registerTicketResponsibilityProvider('yes', yes);
    expect(await resolveTicketResponsibility({ tenant: 't', subject: { resolverFacts: {} } as never })).toBe(yes);
  });
});

describe('responsibility filter is one seat_responsibility where clause', () => {
  it('sets, reads and clears it without touching other clauses', () => {
    const other = { path: 'client.tags', operator: 'in' as const, value: ['x'] };
    const withFilter = setSeatResponsibilityFilter({ join: 'and', clauses: [other] }, 'client_it');
    expect(withFilter?.clauses).toEqual([other, { path: 'seat_responsibility', operator: 'equals', value: 'client_it' }]);
    expect(getSeatResponsibilityFilter(withFilter)).toBe('client_it');
    expect(getSeatResponsibilityFilter(setSeatResponsibilityFilter(withFilter, 'msp'))).toBe('msp');
    expect(setSeatResponsibilityFilter(withFilter, null)?.clauses).toEqual([other]);
    expect(setSeatResponsibilityFilter(setSeatResponsibilityFilter(undefined, 'msp'), null)).toBeUndefined();
  });
});
