import { describe, expect, it } from 'vitest';

import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderTemplateAstHtmlDocument } from '../invoice-template-ast/server-render';
import { assembleSalesOrderViewModel } from '../adapters/salesOrderAdapters';
import { buildStandardSalesOrderConfirmationAst } from './standardTemplates';
import { resolveSalesOrderTemplateAst } from './templateSelection';

const sampleViewModel = () =>
  assembleSalesOrderViewModel({
    so: {
      so_id: 'so-1',
      so_number: 'SO-00042',
      status: 'confirmed',
      order_date: '2026-06-26',
      expected_ship_date: '2026-07-01',
      client_po_number: 'PO-ACME-9',
      currency_code: 'USD',
      notes: 'Leave at the dock.',
      client_id: 'client-1',
    },
    lines: [
      { so_line_id: 'l1', service_id: 'svc-switch', quantity_ordered: 10, quantity_fulfilled: 10, unit_price: 38000 },
      { so_line_id: 'l2', service_id: 'svc-laptop', quantity_ordered: 5, quantity_fulfilled: 3, unit_price: 124000 },
    ],
    servicesById: new Map([
      ['svc-switch', { service_name: 'UniFi Switch 24 PoE', sku: 'UBNT-US24P' }],
      ['svc-laptop', { service_name: 'Dell Latitude 5440', sku: 'DELL-L5440' }],
    ]),
    customer: { name: 'Acme Corp', address: '123 Main St', email: null, phone: null, logo_url: null },
    tenantParty: { name: 'Northwind MSP', address: '400 SW Main', email: null, phone: null, logo_url: null },
  });

describe('standard sales order confirmation template', () => {
  it('evaluates and renders to a non-empty HTML document (validates the AST schema)', async () => {
    const ast = buildStandardSalesOrderConfirmationAst();
    const vm = sampleViewModel();

    const evaluation = evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>);
    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Sales Order' });

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('ORDER CONFIRMATION');
    expect(html).toContain('SO-00042');
    expect(html).toContain('UniFi Switch 24 PoE');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Northwind MSP');
  });

  it('resolveSalesOrderTemplateAst falls back to the standard when no assignment is stored', async () => {
    // Fake knex whose assignment lookups return nothing → standard fallback.
    const builder: any = { where: () => builder, whereNull: () => builder, first: async () => undefined };
    const fakeKnex: any = () => builder;

    const result = await resolveSalesOrderTemplateAst(fakeKnex, 'tenant-1');
    expect(result.source).toBe('standard');
    expect(result.code).toBe('standard-sales-order-confirmation');
    expect(result.ast.metadata?.templateName).toBe('Standard Sales Order Confirmation');
  });
});
