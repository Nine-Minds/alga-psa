// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { shouldWriteTicketListUrl, TICKET_LIST_PATHNAME } from './ticketListUrlSync';

describe('shouldWriteTicketListUrl', () => {
  it('writes while the list is still the page', () => {
    expect(shouldWriteTicketListUrl({
      pathname: TICKET_LIST_PATHNAME,
      hasNavigatedAway: false,
    })).toBe(true);
  });

  it('tolerates a trailing slash on the list route', () => {
    expect(shouldWriteTicketListUrl({
      pathname: '/msp/tickets/',
      hasNavigatedAway: false,
    })).toBe(true);
  });

  it('does not write once the route has moved to a ticket detail', () => {
    // The late writer this guard exists for: a debounced search or a preference
    // landing after the detail route has already committed.
    expect(shouldWriteTicketListUrl({
      pathname: '/msp/tickets/8f1c7a3e-0000-4000-8000-000000000000',
      hasNavigatedAway: false,
    })).toBe(false);
  });

  it('does not write on the routed modals that live under the list', () => {
    for (const pathname of ['/msp/tickets/export', '/msp/tickets/import', '/msp/tickets/bulk-assign']) {
      expect(shouldWriteTicketListUrl({ pathname, hasNavigatedAway: false })).toBe(false);
    }
  });

  it('does not write once a navigation away has been requested', () => {
    // The likelier half of the race: router.push is still in flight, so
    // window.location has not moved yet and the pathname alone still says
    // "list". Without the flag this is exactly the write that replaces the
    // history entry the router just pushed.
    expect(shouldWriteTicketListUrl({
      pathname: TICKET_LIST_PATHNAME,
      hasNavigatedAway: true,
    })).toBe(false);
  });

  it('does not write without a window (SSR / prerender)', () => {
    expect(shouldWriteTicketListUrl({ pathname: null, hasNavigatedAway: false })).toBe(false);
    expect(shouldWriteTicketListUrl({ pathname: undefined, hasNavigatedAway: false })).toBe(false);
  });

  it('does not treat a different route that merely shares a prefix as the list', () => {
    expect(shouldWriteTicketListUrl({
      pathname: '/msp/tickets-archive',
      hasNavigatedAway: false,
    })).toBe(false);
  });
});
