// alga-2026-0002771: by-ticket invoice must show plain-text descriptions and rounded hours.
import { describe, it, expect } from 'vitest';
import type { IClientContractLine, IInvoiceCharge, WasmInvoiceViewModel } from '@alga-psa/types';
import { computeTimeBasedCharges, type TimeBasedChargeComputeInputs } from '@alga-psa/billing/lib/billing/compute/computeTimeBasedCharges';
import { attachInvoiceTimeCollections } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import { getStandardTemplateAstByCode } from '@alga-psa/billing/lib/invoice-template-ast/standardTemplates';
import { evaluateTemplateAst } from '@alga-psa/billing/lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '@alga-psa/billing/lib/invoice-template-ast/react-renderer';

const paragraph = (text: string) => ({ id: 'b', type: 'paragraph', props: { textColor: 'default' }, content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] });
const blockNoteJson = (...paragraphs: string[]) => JSON.stringify(paragraphs.map(paragraph));

function build(description: string | null, title = 'Email outage', minutes = 125) {
  const start = '2026-08-01T00:00:00Z', end = '2026-09-01T00:00:00Z';
  const inputs: TimeBasedChargeComputeInputs = {
    billingPeriod: { startDate: start, endDate: end },
    clientContractLine: { client_contract_line_id: 'line' } as IClientContractLine,
    timing: { duePosition: 'arrears', servicePeriodStart: start, servicePeriodEnd: end, servicePeriodStartExclusive: start, servicePeriodEndExclusive: end, coverageRatio: 1 },
    client: { client_id: 'client' }, plan: {}, serviceConfigMap: new Map(), contractCurrency: 'USD',
    timeEntries: [{
      entry_id: 'entry-0', user_id: 'user', start_time: new Date(start), end_time: new Date(end), service_id: 'service-0', service_name: 'Support',
      custom_rate: 15000, billable_duration: minutes, work_item_type: 'ticket', work_item_id: 'ticket-a',
      ticket_number: 'T-A', ticket_title: title, ticket_description: description,
    }],
  } as TimeBasedChargeComputeInputs;
  const taxContext = {
    getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }), getLocationTaxRegionCode: () => null,
    getClientDefaultTaxRegionCode: () => null, isTaxExemptForProfile: () => false, calculateTax: () => ({ taxAmount: 0, taxRate: 0 }),
  };
  const generated = computeTimeBasedCharges(inputs, taxContext).charges;
  const charges = generated.map((charge, index) => ({
    item_id: `charge-${index}`, invoice_id: 'invoice', tenant: 'tenant', billing_charge_type: charge.type,
    description: charge.serviceName, quantity: charge.quantity, unit_price: charge.rate, net_amount: charge.total,
    time_entry_snapshots: [{ ...charge.workItemSnapshot!, entryId: charge.entryId }],
    time_entry_links: [{ itemId: `charge-${index}`, invoiceId: 'invoice', tenant: 'tenant', entryId: charge.entryId, snapshot: charge.workItemSnapshot }],
  })) as IInvoiceCharge[];
  const total = charges.reduce((sum, c) => sum + c.net_amount, 0);
  const vm: WasmInvoiceViewModel = {
    invoiceNumber: 'INV-000006', issueDate: '2026-09-01', dueDate: '2026-10-01', currencyCode: 'USD',
    customer: { name: 'Test', address: '' }, tenantClient: null,
    items: charges.map((c) => ({ id: c.item_id, description: c.description, quantity: c.quantity, unitPrice: c.unit_price, total: c.net_amount })),
    subtotal: total, tax: 0, total,
  };
  return { vm, charges, generated };
}

const render = async (vm: WasmInvoiceViewModel) => {
  const ast = getStandardTemplateAstByCode('standard-invoice-by-ticket')!;
  return (await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>))).html;
};

describe('standard by-ticket projection: plain-text description and rounded hours', () => {
  it('write time: stores plain text, not BlockNote JSON, in the snapshot', () => {
    const { generated } = build(blockNoteJson('Printer on 2nd floor is down', 'Started this morning'));
    expect(generated[0].workItemSnapshot!.description).toBe('Printer on 2nd floor is down Started this morning');
  });

  it('read time: an already-snapshotted BlockNote JSON description renders as text; 2.083333h shows as 2.08', async () => {
    const { vm, charges } = build('plain');
    // Simulate INV-000006: a snapshot persisted before the write-time fix.
    const legacyJson = blockNoteJson('Printer on 2nd floor is down');
    charges[0].time_entry_snapshots![0].description = legacyJson;
    (charges[0].time_entry_links![0].snapshot as { description: string }).description = legacyJson;
    attachInvoiceTimeCollections(vm, charges);

    const row = vm.ticketPresentationRows!.find((r) => r.id.startsWith('ticket:'))!;
    expect(row.description).toBe('Printer on 2nd floor is down');
    expect(row.quantity).toBe(2.08);
    // The derived 6dp hours and the authoritative minutes are not rounded.
    expect(vm.ticketGroups![0].totalHours).toBe(2.083333);
    expect(vm.ticketGroups![0].totalMinutes).toBe(125);

    const html = await render(vm);
    expect(html).not.toContain('{"type"');
    expect(html).not.toContain('&quot;type&quot;');
    expect(html).toContain('Printer on 2nd floor is down');
    expect(html).toContain('>2.08<');
    expect(html).not.toContain('2.083333');
  });

  it('falls back to the ticket title when the description has only empty paragraphs', () => {
    const { vm, charges } = build(blockNoteJson(''), 'Email outage');
    attachInvoiceTimeCollections(vm, charges);
    const row = vm.ticketPresentationRows!.find((r) => r.id.startsWith('ticket:'))!;
    expect(row.description).toBe('Email outage');
  });

  it('uses an empty cell when there is neither description nor title', () => {
    const { vm, charges } = build(null, '');
    attachInvoiceTimeCollections(vm, charges);
    expect(vm.ticketPresentationRows!.find((r) => r.id.startsWith('ticket:'))!.description).toBe('');
  });

  it('does not prepend the title to a non-empty description', () => {
    const { vm, charges } = build(blockNoteJson('Reset the router'), 'Email outage');
    attachInvoiceTimeCollections(vm, charges);
    expect(vm.ticketPresentationRows!.find((r) => r.id.startsWith('ticket:'))!.description).toBe('Reset the router');
  });
});
