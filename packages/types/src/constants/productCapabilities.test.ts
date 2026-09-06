import { describe, expect, it } from 'vitest';
import { productHasCapability, type ProductCapability } from './productCapabilities';

describe('co-managed product capabilities', () => {
  it.each<ProductCapability>([
    'tickets', 'knowledge_base', 'documents', 'credentials', 'projects', 'scheduling',
    'time_entry', 'assets', 'sla', 'workflows', 'directory_connections',
  ])('includes customer operation: %s', (capability) => {
    expect(productHasCapability('co_managed', capability)).toBe(true);
  });

  it.each<ProductCapability>([
    'billing', 'sales', 'accounting', 'rmm', 'extensions', 'surveys', 'co_management_sponsorship',
  ])('excludes commercial or unapproved operation: %s', (capability) => {
    expect(productHasCapability('co_managed', capability)).toBe(false);
    expect(productHasCapability('psa', capability)).toBe(true);
  });

  it('preserves legacy PSA and AlgaDesk behavior without granting unknown products access', () => {
    expect(productHasCapability(null, 'billing')).toBe(true);
    expect(productHasCapability('algadesk', 'tickets')).toBe(true);
    expect(productHasCapability('algadesk', 'projects')).toBe(false);
    expect(productHasCapability('unknown', 'tickets')).toBe(false);
  });
});
