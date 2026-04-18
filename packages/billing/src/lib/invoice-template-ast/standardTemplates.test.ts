import { describe, expect, it } from 'vitest';
import {
  autoSelectStandardInvoiceTemplateCode,
  getStandardTemplateAstByCode,
  STANDARD_INVOICE_BY_LOCATION_CODE,
  STANDARD_INVOICE_DEFAULT_CODE,
  STANDARD_INVOICE_TEMPLATE_ASTS,
} from './standardTemplates';

describe('standard invoice template AST definitions', () => {
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
