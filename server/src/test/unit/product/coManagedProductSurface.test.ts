import { describe, expect, it } from 'vitest';
import {
  filterMenuSectionsByProduct, filterPortalNavigationByProduct,
  getApiMetadataProducts, resolveProductApiBehavior, resolveProductRouteBehavior,
} from '../../../lib/productSurfaceRegistry';

describe('co-managed product boundary', () => {
  it.each(['projects', 'assets', 'credentials', 'documents', 'schedule', 'time-entry', 'workflow-editor'])
  ('allows operational screen %s without changing AlgaDesk availability', (screen) => {
    expect(resolveProductRouteBehavior('co_managed', `/msp/${screen}`)).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', `/msp/${screen}`)).toBe('upgrade_boundary');
  });

  it.each(['billing', 'opportunities', 'marketing', 'integrations', 'unknown-module'])
  ('denies commercial and unlisted screen %s', (screen) => {
    expect(resolveProductRouteBehavior('co_managed', `/msp/${screen}`)).toBe('not_found');
    expect(resolveProductRouteBehavior('psa', `/msp/${screen}`)).toBe('allowed');
  });

  it.each(['projects', 'assets', 'time-entries', 'documents', 'workflows', 'scheduling'])
  ('allows operational API %s and advertises its product', (resource) => {
    expect(resolveProductApiBehavior('co_managed', `/api/v1/${resource}`)).toBe('allowed');
    expect(getApiMetadataProducts(`/api/v1/${resource}`)).toEqual(['psa', 'co_managed']);
  });

  it.each(['invoices', 'quotes', 'contracts', 'financial', 'accounting-exports', 'rmm', 'integrations', 'unknown-area'])
  ('denies commercial/unlisted API %s', (resource) => {
    expect(resolveProductApiBehavior('co_managed', `/api/v1/${resource}`)).toBe('denied');
    expect(getApiMetadataProducts(`/api/v1/${resource}`)).not.toContain('co_managed');
  });

  it('does not open materials billing when allowing ticket effort and asset links', () => {
    expect(resolveProductApiBehavior('co_managed', '/api/v1/tickets/one/time-entries')).toBe('allowed');
    expect(resolveProductApiBehavior('co_managed', '/api/v1/tickets/one/assets')).toBe('allowed');
    expect(resolveProductApiBehavior('co_managed', '/api/v1/tickets/one/materials')).toBe('denied');
  });

  it('keeps directory provisioning independent of other integrations', () => {
    expect(resolveProductApiBehavior('co_managed', '/api/scim/v2/Users')).toBe('allowed');
    expect(resolveProductApiBehavior('co_managed', '/api/telephony/webhook')).toBe('denied');
  });

  it('filters navigation and direct settings paths consistently', () => {
    expect(resolveProductRouteBehavior('co_managed', '/msp/settings/sla')).toBe('allowed');
    expect(resolveProductRouteBehavior('co_managed', '/desk/settings/integrations')).toBe('not_found');
    expect(filterMenuSectionsByProduct('co_managed', [{ items: [
      { href: '/msp/settings?tab=sla' }, { href: '/msp/settings?tab=integrations' },
      { href: '/msp/billing' }, { href: '/msp/projects' },
    ] }])).toEqual([{ items: [{ href: '/msp/settings?tab=sla' }, { href: '/msp/projects' }] }]);
    expect(filterPortalNavigationByProduct('co_managed', [
      { href: '/client-portal/projects' }, { href: '/client-portal/billing' },
    ])).toEqual([{ href: '/client-portal/projects' }]);
  });
});
