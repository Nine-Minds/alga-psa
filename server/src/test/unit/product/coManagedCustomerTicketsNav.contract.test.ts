import { describe, expect, it } from 'vitest';
import { navigationSections } from '../../../config/menuConfig';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

describe('Customer Tickets navigation entry', () => {
  const tickets = navigationSections.flatMap(s => s.items).find(i => i.translationKey === 'nav.tickets');
  const entry = tickets?.subItems?.find(i => i.href === '/msp/tickets/customer');

  it('is a translated sub-item under Tickets pointing at the queue', () => {
    expect(entry).toMatchObject({ translationKey: 'nav.ticketsCustomer', href: '/msp/tickets/customer' });
  });

  it('the route lookup (middleware/layout) is psa-only for the queue and unchanged for /msp/tickets and ticket ids', () => {
    const id = '3f2b8c1e-5d4a-4e7b-9c1d-2a6f8e0b7c11';
    for (const [product, queue] of [['psa', 'allowed'], ['algadesk', 'not_found'], ['co_managed', 'not_found']] as const) {
      expect(resolveProductRouteBehavior(product, '/msp/tickets/customer'), product).toBe(queue);
      expect(resolveProductRouteBehavior(product, '/msp/tickets/customer/anything'), product).toBe(queue);
      expect(resolveProductRouteBehavior(product, '/msp/tickets'), product).toBe('allowed');
      expect(resolveProductRouteBehavior(product, `/msp/tickets/${id}`), product).toBe('allowed');
      // a ticket whose id merely starts with the word is still a ticket
      expect(resolveProductRouteBehavior(product, '/msp/tickets/customers-x'), product).toBe('allowed');
    }
  });
});
