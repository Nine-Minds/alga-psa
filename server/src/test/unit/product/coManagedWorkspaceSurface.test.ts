import { describe, expect, it } from 'vitest';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

const probe = (route: string) => resolveProductRouteBehavior('co_managed', route);

describe('co_managed workspace product surface (A5)', () => {
  it.each([
    '/msp/billing', '/msp/billing/contracts', '/msp/quotes', '/msp/accounting', '/msp/surveys',
    '/msp/extensions', '/msp/opportunities', '/msp/marketing', '/msp/projects', '/msp/documents',
  ])('%s is denied for a customer workspace', (route) => {
    expect(probe(route)).not.toBe('allowed');
  });

  it.each([
    '/msp/tickets', '/msp/clients', '/msp/contacts', '/msp/knowledge-base', '/msp/profile', '/msp/co-managed',
  ])('%s is allowed for a customer workspace', (route) => {
    expect(probe(route)).toBe('allowed');
  });

  it('/msp/billing is the prefix that carries quotes and accounting exports', () => {
    expect(probe('/msp/billing/quotes')).toBe(probe('/msp/billing'));
    expect(probe('/msp/billing/accounting')).toBe(probe('/msp/billing'));
  });

  it('the removed /msp/co-management route has no rule of its own', () => {
    expect(resolveProductRouteBehavior('psa', '/msp/co-management')).toBe(resolveProductRouteBehavior('psa', '/msp/not-a-real-route'));
  });

  it('psa is identical to before for the co-managed root and everything around it', () => {
    for (const route of ['/msp/co-managed', '/msp/co-managed/x', '/msp/billing', '/msp/tickets', '/msp/clients']) {
      expect(resolveProductRouteBehavior('psa', route)).toBe('allowed');
    }
    expect(resolveProductRouteBehavior('algadesk', '/msp/co-managed')).toBe('not_found');
  });
});
