import { describe, expect, it } from 'vitest';
import type { ProductCode } from '@alga-psa/types';
import { MSP_ROUTE_RULES, resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

type Behavior = 'allowed' | 'upgrade_boundary' | 'not_found';

/**
 * CM L9 A1. The allow/deny matrix for provider setup, as data. Integration
 * categories ride the query string on the integrations root; the root decides.
 */
const MATRIX: ReadonlyArray<[route: string, expected: Record<ProductCode, Behavior>]> = [
  ['/msp/co-management/providers', { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' }],
  ['/msp/settings/integrations', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=providers', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=communication', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=rmm', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=accounting', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=payments', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations?category=payment-processing', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/integrations', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/integrations/rmm', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/integrations/accounting', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/integrations/payments', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  // The side-aware co-managed root beside it is unchanged; mailbox setup stays reachable.
  ['/msp/co-managed', { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' }],
  ['/msp/settings/email', { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' }],
];

describe('provider setup allow/deny matrix (L9 A1)', () => {
  it.each(MATRIX)('%s', (route, expected) => {
    for (const product of Object.keys(expected) as ProductCode[]) {
      expect(resolveProductRouteBehavior(product, route), `${product} ${route}`).toBe(expected[product]);
    }
  });

  it('the providers rule precedes the sponsor group so first-match gives co_managed only that page', () => {
    const groups = MSP_ROUTE_RULES.map((rule) => rule.group);
    expect(groups.indexOf('msp_co_management_providers')).toBeGreaterThanOrEqual(0);
    expect(groups.indexOf('msp_co_management_providers')).toBeLessThan(groups.indexOf('msp_co_managed_sponsor'));
    const rule = MSP_ROUTE_RULES.find((r) => r.group === 'msp_co_management_providers')!;
    expect(rule.staticPrefixes).toEqual(['/msp/co-management/providers']);
  });

  it('the removed /msp/co-management root stays unruled; only administration, customer-tickets, shared projects/tasks and providers are opened beneath it', () => {
    for (const product of ['psa', 'algadesk', 'co_managed'] as ProductCode[]) {
      expect(resolveProductRouteBehavior(product, '/msp/co-management'), product)
        .toBe(resolveProductRouteBehavior(product, '/msp/not-a-real-route'));
    }
    const opened = MSP_ROUTE_RULES.filter((rule) =>
      rule.staticPrefixes?.some((prefix) => prefix.startsWith('/msp/co-management')));
    expect(opened.map((rule) => rule.group)).toEqual([
      'msp_co_managed_administration',
      'msp_co_managed_customer_tickets',
      'msp_co_managed_shared_projects',
      'msp_co_management_providers',
    ]);
  });
});
