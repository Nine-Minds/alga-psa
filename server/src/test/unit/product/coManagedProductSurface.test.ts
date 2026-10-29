import { describe, expect, it } from 'vitest';
import type { ProductCode } from '@alga-psa/types';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

type Behavior = 'allowed' | 'upgrade_boundary' | 'not_found';

// route x product. One side-aware root: a PSA sponsor and a co_managed customer
// both reach /msp/co-managed (the page renders by side); AlgaDesk never does.
const MATRIX: ReadonlyArray<[route: string, expected: Record<ProductCode, Behavior>]> = [
  ['/msp/co-managed', { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' }],
  // The customer's own Effective access / delegated administration is the one sponsor-prefix route co_managed reaches.
  ['/msp/co-management/administration', { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' }],
  ['/msp/tickets', { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' }],
  ['/msp/clients', { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' }],
  ['/msp/projects', { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' }],
  ['/msp/documents', { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' }],
  ['/client-portal/tickets', { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' }],
  ['/msp/billing', { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' }],
  ['/msp/marketing', { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' }],
  ['/msp/integrations', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
  ['/msp/settings/integrations', { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' }],
];

describe('co-managed product surface (L1a)', () => {
  it.each(MATRIX)('%s', (route, expected) => {
    for (const product of Object.keys(expected) as ProductCode[]) {
      expect(resolveProductRouteBehavior(product, route), `${product} ${route}`).toBe(expected[product]);
    }
  });

  it.each(['/msp/co-managed/anything', '/msp/co-managed/access/deeper'])('%s follows its group', (route) => {
    expect(resolveProductRouteBehavior('psa', route)).toBe('allowed');
    expect(resolveProductRouteBehavior('co_managed', route)).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', route)).toBe('not_found');
  });

  it.each(['/msp/co-management/customer-tickets', '/msp/co-management/customer-tickets/r/t', '/msp/co-management/administrationx'])(
    'the administration rule does not open the rest of the sponsor prefix (%s)', (route) => {
      expect(resolveProductRouteBehavior('co_managed', route)).toBe('not_found');
      expect(resolveProductRouteBehavior('psa', route)).toBe('allowed');
    });

  it.each(['/msp/quotes', '/msp/accounting', '/msp/contracts', '/msp/billing/contracts'])(
    'commercial route %s is closed to co_managed', (route) => {
      expect(resolveProductRouteBehavior('co_managed', route)).toBe('not_found');
    });
});
