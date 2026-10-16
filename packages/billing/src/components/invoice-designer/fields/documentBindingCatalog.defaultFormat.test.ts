import { describe, expect, it } from 'vitest';
import { resolveDefaultFieldFormat, resolveDocumentLogoRenderPath } from './documentBindingCatalog';

describe('resolveDefaultFieldFormat', () => {
  it('formats dates, amounts and quantities by what the bound value is', () => {
    expect(resolveDefaultFieldFormat('invoice.issueDate')).toBe('date');
    expect(resolveDefaultFieldFormat('invoice.dueDate')).toBe('date');
    expect(resolveDefaultFieldFormat('invoice.total')).toBe('currency');
    expect(resolveDefaultFieldFormat('invoice.subtotal')).toBe('currency');
    expect(resolveDefaultFieldFormat('item.quantity')).toBe('number');
    expect(resolveDefaultFieldFormat('invoice.number')).toBe('text');
    expect(resolveDefaultFieldFormat('invoice.poNumber')).toBe('text');
  });
});

describe('resolveDocumentLogoRenderPath', () => {
  it('resolves each document type to the logo path its render model exposes', () => {
    expect(resolveDocumentLogoRenderPath('invoice')).toBe('tenantClient.logoUrl');
    expect(resolveDocumentLogoRenderPath('quote')).toBe('tenant.logo_url');
    expect(resolveDocumentLogoRenderPath('sales-order')).toBe('tenantClient.logo_url');
  });
});
