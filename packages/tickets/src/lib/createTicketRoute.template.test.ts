import { describe, expect, it } from 'vitest';
import { buildCreateTicketHref, parseCreateTicketPrefill } from './createTicketRoute';

describe('createTicketRoute template round-trip', () => {
  it('round-trips template and omits it when unset', () => {
    const href = buildCreateTicketHref({ templateId: 'abc' });
    expect(href).toBe('/msp/create-ticket?template=abc');
    const query = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parseCreateTicketPrefill(query).templateId).toBe('abc');

    expect(buildCreateTicketHref({})).toBe('/msp/create-ticket');
    expect(buildCreateTicketHref({ title: 't' })).not.toContain('template=');
    expect(parseCreateTicketPrefill({}).templateId).toBeUndefined();
  });
});
