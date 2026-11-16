import { describe, it, expect } from 'vitest';
import { buildUniformTicketSubject, normalizeTicketSubject } from '../ticketSubject';

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

describe('buildUniformTicketSubject', () => {
  const title = 'Printer offline';
  const expected = '[Ticket #1042] Printer offline';

  it.each([
    ['created', `Your Ticket Has Been Created • ${title}`],
    ['updated', `Ticket Updated: ${title}`],
    ['comment added', `New Comment on Ticket: ${title}`],
    ['assigned', `Ticket Assigned: ${title}`],
    ['closed', `Ticket Closed: ${title}`],
  ])('yields the same subject for the %s event', (_event, rendered) => {
    expect(buildUniformTicketSubject(rendered, 1042, title)).toBe(expected);
  });

  it('keeps leading Re:/Fwd: prefixes', () => {
    expect(buildUniformTicketSubject('Re: Fwd: Ticket Updated: X', 9, 'X')).toBe('Re: Fwd: [Ticket #9] X');
  });

  it('returns the subject unchanged with no ticket number', () => {
    expect(buildUniformTicketSubject('Ticket Updated: X', undefined, 'X')).toBe('Ticket Updated: X');
    expect(buildUniformTicketSubject('Ticket Updated: X', null, 'X')).toBe('Ticket Updated: X');
  });

  it('collapses newlines in the title', () => {
    expect(buildUniformTicketSubject('Ticket Updated: a', 5, 'Line one\r\nline two\n')).toBe('[Ticket #5] Line one line two');
  });

  it('does not double-tag when the rendered subject or title already carries a tag', () => {
    const once = buildUniformTicketSubject('Ticket Updated: X', 7, 'X');
    expect(buildUniformTicketSubject(once, 7, 'X')).toBe(once);
  });

  it('leaves the tenant-custom path tag-only', () => {
    expect(normalizeTicketSubject('Custom: Printer offline', 1042)).toBe('[Ticket #1042] Custom: Printer offline');
  });
});
