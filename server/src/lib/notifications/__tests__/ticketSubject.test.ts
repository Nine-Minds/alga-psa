import { describe, it, expect } from 'vitest';
import { normalizeTicketSubject } from '../ticketSubject';

describe('normalizeTicketSubject', () => {
  it('prepends a [Ticket #N] token', () => {
    expect(normalizeTicketSubject('Printer offline', 1042)).toBe('[Ticket #1042] Printer offline');
  });

  it('accepts a string ticket number', () => {
    expect(normalizeTicketSubject('Printer offline', '1042')).toBe('[Ticket #1042] Printer offline');
  });

  it('is idempotent (does not double-tag)', () => {
    const once = normalizeTicketSubject('Printer offline', 1042);
    expect(normalizeTicketSubject(once, 1042)).toBe(once);
  });

  it('does not re-tag a subject that already carries a token (any spacing)', () => {
    expect(normalizeTicketSubject('[Ticket#7] hi', 7)).toBe('[Ticket#7] hi');
  });

  it('preserves a leading Re: prefix and inserts the token after it', () => {
    expect(normalizeTicketSubject('Re: Printer offline', 1042)).toBe('Re: [Ticket #1042] Printer offline');
  });

  it('preserves stacked Re:/Fwd: prefixes', () => {
    expect(normalizeTicketSubject('Re: Fwd: Printer offline', 9)).toBe('Re: Fwd: [Ticket #9] Printer offline');
  });

  it('returns the subject unchanged when no ticket number is available', () => {
    expect(normalizeTicketSubject('Printer offline', undefined)).toBe('Printer offline');
    expect(normalizeTicketSubject('Printer offline', null)).toBe('Printer offline');
  });
});
