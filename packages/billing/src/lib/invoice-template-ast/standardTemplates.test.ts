import { describe, expect, it } from 'vitest';
import { getStandardTemplateAstByCode, STANDARD_INVOICE_TEMPLATE_ASTS } from './standardTemplates';

describe('standard invoice template AST definitions', () => {
  it('exposes AST definitions for standard template codes', () => {
    expect(Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS)).toEqual(
      expect.arrayContaining(['standard-default', 'standard-detailed'])
    );

    const standardDefaultAst = getStandardTemplateAstByCode('standard-default');
    expect(standardDefaultAst?.kind).toBe('invoice-template-ast');
    expect(standardDefaultAst?.layout.type).toBe('document');
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
