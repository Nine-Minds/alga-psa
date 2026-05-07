import { describe, expect, it } from 'vitest';
import {
  filterMenuSectionsByProduct,
  filterPortalNavigationByProduct,
  isApiVisibleInMetadata,
  matchesDynamicPattern,
  matchesStaticPrefix,
  resolveProductApiBehavior,
  resolveProductRouteBehavior,
} from '../../lib/productSurfaceRegistry';

describe('product surface registry', () => {
  it('T003: classifies representative Algadesk MSP routes as allowed, upgrade-boundary, and not-found', () => {
    expect(resolveProductRouteBehavior('algadesk', '/msp/tickets')).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', '/msp/billing')).toBe('upgrade_boundary');
    expect(resolveProductRouteBehavior('algadesk', '/msp/test/ui-kit')).toBe('not_found');
  });

  it('T003: classifies representative Algadesk portal routes correctly', () => {
    expect(resolveProductRouteBehavior('algadesk', '/client-portal/tickets')).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', '/client-portal/client-settings')).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', '/client-portal/settings')).toBe('not_found');
    expect(resolveProductRouteBehavior('algadesk', '/client-portal/billing')).toBe('upgrade_boundary');
  });

  it('T003: classifies representative API paths and fails closed for unknown API groups', () => {
    expect(resolveProductApiBehavior('algadesk', '/api/v1/tickets')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/clients')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/contacts')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/kb-articles')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/meta/endpoints')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/email/oauth/initiate')).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/tickets/ticket-1/time-entries')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/tickets/ticket-1/materials')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/tickets/from-asset')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/billing')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/financial')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/v1/unknown-area')).toBe('denied');
  });

  it('T003: filters metadata/OpenAPI visibility by product', () => {
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/tickets')).toBe(true);
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/meta/endpoints')).toBe(true);
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/tickets/ticket-1/time-entries')).toBe(false);
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/billing')).toBe(false);
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/unknown-area')).toBe(false);
  });

  it('T003: provides static and dynamic route matcher helpers', () => {
    expect(matchesStaticPrefix('/msp/tickets/123', ['/msp/tickets'])).toBe(true);
    expect(matchesStaticPrefix('/msp/tickets', ['/msp/clients'])).toBe(false);
    expect(matchesDynamicPattern('/msp/tickets/123', [/^\/msp\/tickets\/[a-z0-9-]+$/i])).toBe(true);
  });

  it('T003: supports future /desk aliases via shared route group mapping', () => {
    expect(resolveProductRouteBehavior('algadesk', '/desk/tickets')).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', '/desk/billing')).toBe('upgrade_boundary');
  });

  it('T003: filters MSP menu sections and portal nav by product', () => {
    const filteredMenu = filterMenuSectionsByProduct('algadesk', [
      {
        items: [
          { href: '/msp/tickets' },
          { href: '/msp/billing' },
          {
            subItems: [{ href: '/msp/knowledge-base' }, { href: '/msp/projects' }],
          },
        ],
      },
    ]);

    expect(filteredMenu[0].items).toHaveLength(2);
    expect(filteredMenu[0].items[0]).toMatchObject({ href: '/msp/tickets' });
    expect(filteredMenu[0].items[1]).toMatchObject({
      subItems: [{ href: '/msp/knowledge-base' }],
    });

    const portalNav = filterPortalNavigationByProduct('algadesk', [
      { href: '/client-portal/tickets' },
      { href: '/client-portal/billing' },
    ]);
    expect(portalNav).toEqual([{ href: '/client-portal/tickets' }]);
  });



  it('T003: narrows Algadesk settings navigation tabs and excludes denied direct settings routes', () => {
    const filteredSettings = filterMenuSectionsByProduct('algadesk', [
      {
        items: [
          { href: '/msp/settings?tab=email' },
          { href: '/msp/settings?tab=knowledge-base' },
          { href: '/msp/settings?tab=integrations' },
          { href: '/msp/settings/extensions' },
          { href: '/msp/settings/notifications' },
        ],
      },
    ]);

    expect(filteredSettings).toEqual([
      {
        items: [
          { href: '/msp/settings?tab=email' },
          { href: '/msp/settings?tab=knowledge-base' },
        ],
      },
    ]);
  });

  it('T003: keeps PSA route and API behavior fully allowed for representative denied Algadesk groups', () => {
    expect(resolveProductRouteBehavior('psa', '/msp/settings/extensions')).toBe('allowed');
    expect(resolveProductApiBehavior('psa', '/api/v1/financial')).toBe('allowed');
    expect(resolveProductApiBehavior('psa', '/api/email/oauth/initiate')).toBe('allowed');
    expect(resolveProductApiBehavior('psa', '/api/integrations/entra/connect')).toBe('allowed');
  });
});
