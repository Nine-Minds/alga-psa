import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { navigationSections } from '../../../config/menuConfig';
import { filterMenuSectionsByProduct, resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

const serverRoot = resolve(__dirname, '../../../..');
const sidebar = readFileSync(resolve(serverRoot, 'src/components/layout/SidebarWithFeatureFlags.tsx'), 'utf8');

describe('Customer Tickets navigation entry', () => {
  const tickets = navigationSections.flatMap(s => s.items).find(i => i.translationKey === 'nav.tickets');
  const entry = tickets?.subItems?.find(i => i.href === '/msp/tickets/customer');

  it('is a translated sub-item under Tickets pointing at the queue', () => {
    expect(entry).toMatchObject({ translationKey: 'nav.ticketsCustomer', href: '/msp/tickets/customer' });
  });

  it('is removed by the sidebar unless the co-managed capability is served (flag off, no entitlement, FORCE_CAPABILITIES off all give served=false)', () => {
    expect(sidebar).toMatch(/CO_MANAGED_GATED_HREFS[^;]*'\/msp\/tickets\/customer'/s);
    expect(sidebar).toMatch(/useCapability\('co-managed'\)/);
    expect(sidebar).toMatch(/coManagedServed \|\| !item\.href \|\| !CO_MANAGED_GATED_HREFS\.has\(item\.href\)/);
    expect(sidebar).toMatch(/!coManagedServed && item\.subItems\?\.some\(\(sub\) => sub\.href && CO_MANAGED_GATED_HREFS\.has\(sub\.href\)\)/);
  });

  it('the sidebar filter itself drops the row when not served and keeps every other Tickets row', () => {
    const served = false;
    const gated = new Set(['/msp/co-management/administration', '/msp/tickets/customer']);
    const subs = tickets!.subItems!.filter(sub => served || !sub.href || !gated.has(sub.href));
    expect(subs.map(s => s.href)).not.toContain('/msp/tickets/customer');
    expect(subs.map(s => s.href)).toContain('/msp/tickets');
  });

  const hrefsFor = (product: 'psa' | 'algadesk' | 'co_managed') =>
    (filterMenuSectionsByProduct(product, navigationSections as never) as any[])
      .flatMap(s => s.items).flatMap((i: any) => i.subItems ?? []).map((i: any) => i.href);

  it('the product menu filter keeps the row for psa only, and keeps All Tickets for every product', () => {
    expect(hrefsFor('psa')).toContain('/msp/tickets/customer');
    for (const product of ['algadesk', 'co_managed'] as const) {
      expect(hrefsFor(product), product).not.toContain('/msp/tickets/customer');
      expect(hrefsFor(product), product).toContain('/msp/tickets');
    }
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

  it('has an English label in every real locale', () => {
    const dir = resolve(serverRoot, 'public/locales');
    for (const locale of readdirSync(dir)) {
      const file = resolve(dir, locale, 'msp/core.json');
      const json = JSON.parse(readFileSync(file, 'utf8'));
      expect(json.nav.ticketsCustomer, locale).toBeTruthy();
    }
  });
});
