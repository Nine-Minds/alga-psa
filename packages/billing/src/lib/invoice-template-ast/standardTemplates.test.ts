import { describe, expect, it } from 'vitest';
import {
  autoSelectStandardInvoiceTemplateCode,
  getStandardTemplateAstByCode,
  STANDARD_INVOICE_BY_LOCATION_CODE,
  STANDARD_INVOICE_DEFAULT_CODE,
  STANDARD_INVOICE_TEMPLATE_ASTS,
} from './standardTemplates';

const collectNodesById = (node: unknown, id: string, out: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectNodesById(item, id, out);
    return out;
  }
  if ((node as any).id === id) out.push(node);
  for (const key of Object.keys(node)) collectNodesById((node as any)[key], id, out);
  return out;
};

describe('standard invoice template AST definitions', () => {
  // Regression: alga0002161 — the issuer-logo image must letterbox (object-fit:
  // contain) instead of stretching non-wide logos to the 180x72 box.
  it('sets object-fit on every issuer-logo node so logos are not squashed', () => {
    const logos = Object.values(STANDARD_INVOICE_TEMPLATE_ASTS).flatMap((ast) =>
      collectNodesById(ast, 'issuer-logo'),
    );
    expect(logos.length).toBeGreaterThan(0);
    for (const logo of logos) {
      expect(logo.style?.inline?.objectFit).toBe('contain');
      expect(logo.style?.inline?.objectPosition).toBe('left');
    }
  });

  it('exposes AST definitions for standard template codes', () => {
    expect(Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS)).toEqual(
      expect.arrayContaining([
        'standard-default',
        'standard-detailed',
        'standard-invoice-by-location',
      ])
    );

    const standardDefaultAst = getStandardTemplateAstByCode('standard-default');
    expect(standardDefaultAst?.kind).toBe('invoice-template-ast');
    expect(standardDefaultAst?.layout.type).toBe('document');
  });

  it('auto-selects the by-location template when the view model has multiple locations', () => {
    expect(autoSelectStandardInvoiceTemplateCode({ hasMultipleLocations: true })).toBe(
      STANDARD_INVOICE_BY_LOCATION_CODE,
    );
    expect(autoSelectStandardInvoiceTemplateCode({ hasMultipleLocations: false })).toBe(
      STANDARD_INVOICE_DEFAULT_CODE,
    );
    expect(autoSelectStandardInvoiceTemplateCode(null)).toBe(STANDARD_INVOICE_DEFAULT_CODE);
  });

  it('exposes a groupsByLocation collection binding on the by-location template', () => {
    const byLocationAst = getStandardTemplateAstByCode(STANDARD_INVOICE_BY_LOCATION_CODE);
    expect(byLocationAst).toBeTruthy();
    expect(byLocationAst?.bindings?.collections).toMatchObject({
      groupsByLocation: { path: 'groupsByLocation' },
    });
  });

  it('uses a repeating stack "location-bands" with a nested dynamic-table bound to group.items', () => {
    const byLocationAst = getStandardTemplateAstByCode(STANDARD_INVOICE_BY_LOCATION_CODE);
    expect(byLocationAst).toBeTruthy();
    const serializedLayout = JSON.stringify(byLocationAst?.layout);
    expect(serializedLayout).toContain('"id":"location-bands"');
    expect(serializedLayout).toContain('"id":"location-band-header"');
    expect(serializedLayout).toContain('"id":"location-band-items"');
    expect(serializedLayout).toContain('"id":"location-band-subtotal"');
    // Inner dynamic-table sources from the scope-named `group.items` binding.
    expect(serializedLayout).toContain('"bindingId":"group.items"');
    // The old flat line-items-by-location table is gone.
    expect(serializedLayout).not.toContain('"id":"line-items-by-location"');
    expect(serializedLayout).not.toContain('"id":"location-summary"');
  });

  it('returns cloned AST payloads to avoid mutation leaks', () => {
    const first = getStandardTemplateAstByCode('standard-default');
    const second = getStandardTemplateAstByCode('standard-default');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('ships a richer detailed template layout with issuer/customer address blocks', () => {
    const detailedAst = getStandardTemplateAstByCode('standard-detailed');
    expect(detailedAst).toBeTruthy();

    expect(detailedAst?.bindings?.values).toMatchObject({
      tenantClientLogo: { path: 'tenantClient.logoUrl' },
      tenantClientAddress: { path: 'tenantClient.address' },
      customerAddress: { path: 'customer.address' },
      recurringServicePeriodStart: { path: 'recurringServicePeriodStart' },
      recurringServicePeriodEnd: { path: 'recurringServicePeriodEnd' },
      recurringServicePeriodLabel: { path: 'recurringServicePeriodLabel' },
    });

    const serializedLayout = JSON.stringify(detailedAst?.layout);
    expect(serializedLayout).toContain('"id":"issuer-logo"');
    expect(serializedLayout).toContain('"id":"party-blocks"');
    expect(serializedLayout).toContain('"id":"bill-to-card"');
    expect(serializedLayout).toContain('"id":"totals-wrap"');
  });
});
