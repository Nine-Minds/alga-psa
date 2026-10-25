import { expect, it } from 'vitest';
import { coManagedTicketReturnHref, DEFAULT_CUSTOMER_TICKETS_HREF } from '../../../lib/co-managed/ticketListReturn';

it('round-trips qualified scope, search, sort and pagination while dropping unrelated query keys', () => {
  const input = '/msp/tickets/customer?queueView=oversight&workspace=1f98df77-cd15-44c2-8f4d-42ff52d01e84&queueState=all&searchQuery=printer%20%26%20router&queueSort=title&queueDirection=asc&page=2&pageSize=1&unknown=discard';
  const output = new URL(coManagedTicketReturnHref(input), 'https://review.invalid');
  const original = new URL(input, 'https://review.invalid');
  for (const key of ['queueView', 'workspace', 'queueState', 'searchQuery', 'queueSort', 'queueDirection', 'page', 'pageSize']) {
    expect(output.searchParams.get(key)).toBe(original.searchParams.get(key));
  }
  expect(output.searchParams.has('unknown')).toBe(false);
});

it.each([
  undefined, ['one', 'two'], 'https://example.org/msp/tickets/customer?queueView=working',
  '//example.org/msp/tickets/customer?queueView=working', '/\\example.org/msp/tickets/customer?queueView=working',
  'javascript:alert(1)', '/msp/tickets/customer-elsewhere?queueView=working',
  '/msp/account', '/msp/tickets/customer?queueView=invalid',
])('uses the customer queue for invalid return context %s', value => {
  expect(coManagedTicketReturnHref(value)).toBe(DEFAULT_CUSTOMER_TICKETS_HREF);
});
