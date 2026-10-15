import { describe, expect, it } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { getStandardTemplateAstByCode } from './standardTemplates';
import { attachInvoiceTimeCollections, enrichWithGroupedItems } from '../adapters/invoiceAdapters';
import { getPreviewSampleScenarioById } from '../../components/invoice-designer/preview/sampleScenarios';

const render = async (vm: WasmInvoiceViewModel, code = 'standard-invoice-by-ticket') => {
  const ast = getStandardTemplateAstByCode(code)!;
  return (await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>))).html;
};
describe('standard by-ticket complete presentation', () => {
  it('shows one table with ticket rows and the non-time charge once', async () => {
    const vm = getPreviewSampleScenarioById('sample-ticket-time-detail')!.data;
    const html = await render(vm);
    expect(html.match(/<table /g)).toHaveLength(1);
    for (const text of ['T-20260118-004 — Email outage', 'T-20260122-011 — Onboard', 'Managed Endpoint Monitoring']) {
      expect(html.split(text)).toHaveLength(2);
    }
    expect(html).toContain('Mixed rates');
    expect(html).toContain('$1,666.70');
    expect(html).not.toContain('1/19/2026');
    expect(html).toContain('Contact your service provider for a billed-time breakdown.');
    expect(html).not.toContain('available in the client portal');
    expect(vm.ticketPresentationRows!.reduce((sum, row) => sum + row.amount, 0)).toBe(vm.items.reduce((sum, item) => sum + item.total, 0));
  });
  it('preserves all canonical rows on legacy input with unavailable linked time', async () => {
    const vm = structuredClone(getPreviewSampleScenarioById('sample-ticket-time-detail')!.data);
    delete vm.ticketPresentationRows; delete vm.timeEntries; delete vm.ticketGroups;
    attachInvoiceTimeCollections(vm, vm.items.map((item) => ({ item_id: item.id, invoice_id: 'legacy', tenant: 'tenant',
      time_entry_links: item.id.startsWith('time-') ? [{ itemId: item.id, entryId: item.id, invoiceId: 'legacy', tenant: 'tenant', snapshot: null }] : [],
    })));
    const html = await render(vm);
    expect(vm.ticketPresentationRows).toHaveLength(vm.items.length);
    expect(html).toContain('Remote Support'); expect(html).toContain('Rate unavailable');
    expect(html).toContain('Ticket detail is unavailable. All charges are shown below.');
    expect(html).not.toContain('Mixed rates');
  });
  it('gives raw canonical samples a primary source without modifying their items', () => {
    const vm = structuredClone(getPreviewSampleScenarioById('sample-simple-services')!.data);
    delete vm.ticketPresentationRows;
    const original = JSON.stringify(vm.items);
    enrichWithGroupedItems(vm);
    expect(vm.ticketPresentationRows).toHaveLength(vm.items.length);
    expect(JSON.stringify(vm.items)).toBe(original);
  });
});
