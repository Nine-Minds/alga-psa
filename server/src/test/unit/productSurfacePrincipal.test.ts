import { describe, expect, it } from 'vitest';
import { PRODUCT_CODES } from '@alga-psa/types';
import {
  MSP_ROUTE_RULES,
  PORTAL_ROUTE_RULES,
  filterMenuSectionsByProduct,
  filterPortalNavigationByProduct,
  resolveProductCapabilityBehavior,
  resolveProductRouteBehavior,
  type ProductPrincipal,
} from '../../lib/productSurfaceRegistry';
import { CO_MANAGED_SEAT_SURFACE } from '@shared/services/productSurfaceKinds';
import { bottomMenuItems, navigationSections, settingsNavigationSections } from '../../config/menuConfig';

const seat = (productCode: ProductPrincipal['productCode'] = 'psa'): ProductPrincipal => ({
  productCode,
  surfaceKind: CO_MANAGED_SEAT_SURFACE,
});

describe('product surface registry resolves per principal (S12 F029)', () => {
  describe('a seat principal', () => {
    it.each([
      '/msp/tickets',
      '/msp/tickets/6f1c0b8e-0000-4000-8000-000000000000',
      '/msp/tickets/canned-responses',
      '/msp/projects',
      '/msp/projects/6f1c0b8e-0000-4000-8000-000000000000',
      '/msp/assets',
      '/msp/assets/6f1c0b8e-0000-4000-8000-000000000000',
      '/msp/documents',
      '/msp/time-entry',
      '/msp/time-entry/timesheet/6f1c0b8e-0000-4000-8000-000000000000',
      '/desk/tickets',
      '/msp/tickets?view=with-msp',
    ])('reaches the operational route %s', (pathname) => {
      expect(resolveProductRouteBehavior(seat(), pathname)).toBe('allowed');
    });

    it.each([
      ['billing', '/msp/billing'],
      ['billing with a tab', '/msp/billing?tab=client-contracts'],
      ['settings', '/msp/settings'],
      ['a settings tab', '/msp/settings/general'],
      ['user administration', '/msp/settings/users'],
      ['dispatch', '/msp/technician-dispatch'],
      ['schedule', '/msp/schedule'],
      ['reports', '/msp/reports'],
      ['co-managed administration', '/msp/co-managed'],
      ['the delegated administration screen', '/msp/co-management/administration'],
      ['time sheet approvals', '/msp/time-sheet-approvals'],
      ['clients', '/msp/clients'],
      ['the dashboard', '/msp/dashboard'],
      ['the sponsor customer-ticket queue', '/msp/tickets/customer'],
      ['recurring tickets', '/msp/tickets/recurring'],
      ['project templates', '/msp/projects/templates'],
      ['asset custody', '/msp/assets/custody'],
      ['a route no rule names', '/msp/some/route/added/later'],
      ['a prefix that merely starts like an operational one', '/msp/ticketsfoo'],
      ['the client portal', '/client-portal/tickets'],
    ])('gets not_found for %s', (_label, pathname) => {
      expect(resolveProductRouteBehavior(seat(), pathname)).toBe('not_found');
    });

    it('is closed to a principal kind nobody registered', () => {
      expect(resolveProductRouteBehavior({ productCode: 'psa', surfaceKind: 'not_a_kind' }, '/msp/tickets')).toBe('not_found');
      expect(resolveProductCapabilityBehavior({ productCode: 'psa', surfaceKind: 'not_a_kind' }, 'scheduling_time_actions')).toBe('denied');
    });

    it('keeps the product gate: the surface intersects with the tenant product, it never widens it', () => {
      expect(resolveProductRouteBehavior(seat('algadesk'), '/msp/projects')).toBe('upgrade_boundary');
      expect(resolveProductRouteBehavior(seat('co_managed'), '/msp/projects')).toBe('not_found');
    });

    it('reaches the time capability and no other product-guarded capability', () => {
      expect(resolveProductCapabilityBehavior(seat(), 'scheduling_time_actions')).toBe('allowed');
      for (const capability of [
        'billing_actions',
        'extension_actions',
        'workflow_actions',
        'survey_actions',
        'asset_rmm_actions',
        'document_management_actions',
        'project_actions',
        'anything_added_later',
      ]) {
        expect(resolveProductCapabilityBehavior(seat(), capability)).toBe('denied');
      }
    });
  });

  describe('an ordinary principal is answered exactly as before', () => {
    const everyRoute = [
      ...MSP_ROUTE_RULES,
      ...PORTAL_ROUTE_RULES,
    ].flatMap((rule) => [...(rule.staticPrefixes ?? []), ...(rule.staticPrefixes ?? []).map((p) => `${p}/child`)]);
    const extraRoutes = ['/msp', '/msp/dashboard', '/msp/unmatched', '/msp/settings', '/msp/settings/sla', '/msp/settings/users', '/client-portal', '/desk/tickets', '/msp/billing?tab=x'];

    it.each([...PRODUCT_CODES])('resolves every route identically for %s whether given a code or a principal', (productCode) => {
      for (const pathname of [...everyRoute, ...extraRoutes]) {
        const byCode = resolveProductRouteBehavior(productCode, pathname);
        expect(resolveProductRouteBehavior({ productCode }, pathname)).toBe(byCode);
        expect(resolveProductRouteBehavior({ productCode, surfaceKind: null }, pathname)).toBe(byCode);
      }
    });

    it('keeps the pinned answers', () => {
      expect(resolveProductRouteBehavior('psa', '/msp/billing')).toBe('allowed');
      expect(resolveProductRouteBehavior('algadesk', '/msp/projects')).toBe('upgrade_boundary');
      expect(resolveProductRouteBehavior('co_managed', '/msp/projects')).toBe('not_found');
      expect(resolveProductRouteBehavior('psa', '/msp/anything-unmatched')).toBe('allowed');
      expect(resolveProductRouteBehavior('algadesk', '/msp/anything-unmatched')).toBe('not_found');
    });

    it.each([...PRODUCT_CODES])('allows every capability for %s: only the guards decide by product', (productCode) => {
      expect(resolveProductCapabilityBehavior(productCode, 'billing_actions')).toBe('allowed');
      expect(resolveProductCapabilityBehavior({ productCode, surfaceKind: null }, 'billing_actions')).toBe('allowed');
    });

    it.each([...PRODUCT_CODES])('filters the real menu identically for %s whether given a code or a principal', (productCode) => {
      expect(filterMenuSectionsByProduct({ productCode }, navigationSections)).toEqual(filterMenuSectionsByProduct(productCode, navigationSections));
      expect(filterMenuSectionsByProduct({ productCode }, settingsNavigationSections)).toEqual(filterMenuSectionsByProduct(productCode, settingsNavigationSections));
      expect(filterMenuSectionsByProduct({ productCode }, [{ items: bottomMenuItems }])).toEqual(filterMenuSectionsByProduct(productCode, [{ items: bottomMenuItems }]));
    });
  });

  describe('the menu of a seat principal', () => {
    const hrefs = (sections: ReturnType<typeof filterMenuSectionsByProduct>) =>
      sections.flatMap((section) => section.items.flatMap((item) => (item.subItems ? item.subItems.map((sub) => sub.href) : [item.href])));

    it('keeps only the operational sections of the real menu', () => {
      const kept = hrefs(filterMenuSectionsByProduct(seat(), navigationSections));
      expect(kept.sort()).toEqual([
        '/msp/assets',
        '/msp/documents',
        '/msp/projects',
        '/msp/tickets',
        '/msp/tickets/canned-responses',
        '/msp/time-entry',
      ]);
    });

    it('keeps nothing of the settings menu, the footer links or the portal navigation', () => {
      expect(filterMenuSectionsByProduct(seat(), settingsNavigationSections)).toEqual([]);
      expect(filterMenuSectionsByProduct(seat(), [{ items: bottomMenuItems }])).toEqual([]);
      expect(filterPortalNavigationByProduct(seat(), [{ href: '/client-portal/tickets' }])).toEqual([]);
    });

    it('drops an external link and an entry with no destination', () => {
      expect(filterMenuSectionsByProduct(seat(), [{ items: [{ href: 'https://example.com/help' }, {}, { href: '/msp/tickets' }] }]))
        .toEqual([{ items: [{ href: '/msp/tickets' }] }]);
    });
  });
});
