import { describe, expect, it } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from './bindingAliases';
import {
  buildInvoiceTemplateBindings,
  getStandardTemplateAstByCode,
} from './standardTemplates';
import { mapDbInvoiceToWasmViewModel } from '../adapters/invoiceAdapters';
import { getPreviewSampleScenarioById } from '../../components/invoice-designer/preview/sampleScenarios';

const renderViewModel = async (viewModel: WasmInvoiceViewModel) => {
  const ast = getStandardTemplateAstByCode('standard-invoice-by-ticket');
  expect(ast).toBeDefined();
  const evaluation = evaluateTemplateAst(
    ast!,
    viewModel as unknown as Record<string, unknown>,
    { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES },
  );
  return renderEvaluatedTemplateAst(ast!, evaluation, {});
};

describe('invoice template bindings: billed-time collections', () => {
  it('exposes ticketGroups and timeEntries collection bindings for the designer', () => {
    const bindings = buildInvoiceTemplateBindings();
    expect(bindings.collections?.ticketGroups).toMatchObject({
      kind: 'collection',
      path: 'ticketGroups',
    });
    expect(bindings.collections?.timeEntries).toMatchObject({
      kind: 'collection',
      path: 'timeEntries',
    });
  });
});

describe('standard-invoice-by-ticket rendering', () => {
  it('rolls each ticket into one summary row with description, hours, honest rate, and amount', async () => {
    const scenario = getPreviewSampleScenarioById('sample-ticket-time-detail');
    expect(scenario).not.toBeNull();

    const { html } = await renderViewModel(scenario!.data);

    // Uniform-rate ticket: label, customer-visible description, aggregated
    // hours (90 + 60 minutes = 2.5h), locale-formatted rate, summed amount.
    expect(html).toContain('T-20260118-004 — Email outage — Exchange connector down');
    expect(html).toContain('Investigated failed mail flow and restored the Exchange connector.');
    expect(html).toContain('2.5');
    expect(html).toContain('$150.00');
    expect(html).toContain('$375.00'); // 22,500 + 15,000 minor units

    // Mixed-rate ticket must say so — never a blended figure ($130.00 would
    // be the fabricated blend of $125 and $150 across 2.5h).
    expect(html).toContain('T-20260122-011 — Onboard new staff workstation');
    expect(html).toContain('Mixed rates');
    expect(html).toContain('$325.00');
    expect(html).not.toContain('$130.00');

    // Project-task time gets its own rolled-up row under the task name.
    expect(html).toContain('Server migration — data sync validation');

    // Per-entry lines are NOT the default output: no per-entry dates render.
    expect(html).not.toContain('1/19/2026');
    expect(html).not.toContain('1/23/2026');

    // The invoice directs the client to the portal for the breakdown.
    expect(html).toContain('available in the client portal');

    // Overall invoice totals stay driven by the line items.
    expect(html).toContain('$1,666.70');
  });

  it('renders the explicit empty state for legacy invoices without snapshot collections', async () => {
    const legacy: WasmInvoiceViewModel = {
      invoiceNumber: 'INV-LEGACY-1',
      issueDate: '2025-01-01',
      dueDate: '2025-01-15',
      currencyCode: 'USD',
      customer: { name: 'Old Customer', address: '1 Old Rd' },
      tenantClient: null,
      items: [
        {
          id: 'item-1',
          description: 'Remote Support',
          quantity: 2,
          unitPrice: 15000,
          total: 30000,
        },
      ],
      subtotal: 30000,
      tax: 0,
      total: 30000,
      // No timeEntries / ticketGroups — pre-snapshot invoice.
    };

    const { html } = await renderViewModel(legacy);

    expect(html).toContain('INV-LEGACY-1');
    expect(html).toContain('Remote Support');
    // Historical detail is unavailable by design — stated, not fabricated.
    expect(html).toContain('No billed-time detail is available for this invoice.');
    expect(html).not.toContain('Mixed rates');
  });

  it('produces an identical billed-time summary for the designer sample and a DB-shaped invoice with the same snapshots', async () => {
    const scenario = getPreviewSampleScenarioById('sample-ticket-time-detail');
    expect(scenario).not.toBeNull();
    const sampleRender = await renderViewModel(scenario!.data);

    // Rebuild the same invoice the way the persisted read path delivers it:
    // charges carrying time_entry_snapshots, mapped through the shared adapter.
    const dbShaped = mapDbInvoiceToWasmViewModel({
      invoice_number: scenario!.data.invoiceNumber,
      invoice_date: scenario!.data.issueDate,
      due_date: scenario!.data.dueDate,
      currency_code: scenario!.data.currencyCode,
      tax_source: 'internal',
      client: {
        name: scenario!.data.customer.name,
        address: scenario!.data.customer.address,
      },
      invoice_charges: (scenario!.data.timeEntries ?? []).map((entry) => ({
        item_id: entry.itemId,
        description: entry.serviceName,
        quantity: entry.hours,
        unit_price: entry.rate,
        net_amount: entry.amount,
        total_price: entry.amount,
        time_entry_snapshots: [
          {
            version: 1 as const,
            entryId: entry.id,
            workItemType: entry.workItemType,
            workItemId: entry.workItemId,
            ticketNumber: entry.ticketNumber,
            title: entry.title,
            description: entry.description,
            entryDate: entry.date,
            billedMinutes: entry.billedMinutes,
            rate: entry.rate,
            netAmount: entry.amount,
            serviceId: entry.serviceId,
            serviceName: entry.serviceName,
          },
        ],
      })),
      subtotal: scenario!.data.subtotal,
      tax: scenario!.data.tax,
      total: scenario!.data.total,
    });
    expect(dbShaped).not.toBeNull();
    const dbRender = await renderViewModel(dbShaped!);

    const extractSummary = (html: string) => {
      const start = html.indexOf('id="billed-time-heading"');
      expect(start).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf('id="totals-wrap"', start));
    };

    expect(extractSummary(dbRender.html)).toBe(extractSummary(sampleRender.html));
  });
});
