import { importTemplateAstToWorkspace, exportWorkspaceToTemplateAst } from '@alga-psa/billing/components/invoice-designer/ast/workspaceAst';
import { describe, it, expect } from 'vitest';
import type { IClientContractLine, IInvoiceCharge, WasmInvoiceViewModel, TemplateAst } from '@alga-psa/types';
import { computeTimeBasedCharges, type TimeBasedChargeComputeInputs } from '@alga-psa/billing/lib/billing/compute/computeTimeBasedCharges';
import { attachInvoiceTimeCollections } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import { getStandardTemplateAstByCode } from '@alga-psa/billing/lib/invoice-template-ast/standardTemplates';
import { evaluateTemplateAst } from '@alga-psa/billing/lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '@alga-psa/billing/lib/invoice-template-ast/react-renderer';
import { localizeTimePresentation } from '@alga-psa/billing/lib/invoice-template-ast/timePresentationLocalization';
import { resolveCollectionDescriptor } from '@alga-psa/billing/lib/invoice-template-ast/collectionDescriptors';
import { resolveCanvasCollection, resolveCanvasRowScope, resolveTableItemBindingRawValue } from '@alga-psa/billing/components/invoice-designer/preview/previewBindings';
import fr from '../../../../public/locales/fr/documents.json';
import { normalizeResolvedContractCharge, calculateNormalizedContractCharge } from '@alga-psa/billing/lib/billing/domain/calculateContractCharge';
import { buildQuoteTemplateBindings } from '@alga-psa/billing/lib/quote-template-ast/bindings';
import { buildSalesOrderTemplateBindings } from '@alga-psa/billing/lib/sales-order-template-ast/bindings';

// Source inputs drive the actual calculator. Only its synchronous tax port is a no-tax fake.
function fixture(overtimeRate = 22500, entryOverrides: Record<string, unknown>[] = [], configure?: (inputs: TimeBasedChargeComputeInputs) => void) {
  const start = '2026-08-01T00:00:00Z', end = '2026-09-01T00:00:00Z';
  const inputs: TimeBasedChargeComputeInputs = {
    billingPeriod: { startDate: start, endDate: end },
    clientContractLine: { client_contract_line_id: 'line' } as IClientContractLine,
    timing: { duePosition: 'arrears', servicePeriodStart: start, servicePeriodEnd: end, servicePeriodStartExclusive: start, servicePeriodEndExclusive: end, coverageRatio: 1 },
    client: { client_id: 'client' }, plan: { enable_overtime: true, overtime_threshold: 1, overtime_rate: overtimeRate },
    serviceConfigMap: new Map(), contractCurrency: 'USD',
    timeEntries: [120, 60, 60].map((minutes, index) => ({
      entry_id: `entry-${index}`, user_id: 'user', start_time: new Date(start), end_time: new Date(end),
      service_id: `service-${index}`, service_name: `Accounting description ${index}`, custom_rate: index === 2 ? 18000 : 15000,
      billable_duration: minutes, work_item_type: 'ticket', work_item_id: index === 0 ? 'ticket-a' : 'ticket-b',
      ticket_number: index === 0 ? 'T-A' : 'T-B', ticket_title: 'Public title', ticket_description: 'Public description',
      ...entryOverrides[index],
    })),
  };
  const taxContext = {
    getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }), getLocationTaxRegionCode: () => null,
    getClientDefaultTaxRegionCode: () => null, isTaxExemptForProfile: () => false, calculateTax: () => ({ taxAmount: 0, taxRate: 0 }),
  };
  configure?.(inputs);
  const generated = computeTimeBasedCharges(inputs, taxContext).charges;
  const charges = generated.map((charge, index) => ({
    item_id: `charge-${index}`, invoice_id: 'invoice', tenant: 'tenant', billing_charge_type: charge.type,
    description: charge.serviceName, quantity: charge.quantity, unit_price: charge.rate, net_amount: charge.total,
    time_entry_snapshots: [{ ...charge.workItemSnapshot!, entryId: charge.entryId }],
    time_entry_links: [{ itemId: `charge-${index}`, invoiceId: 'invoice', tenant: 'tenant', entryId: charge.entryId, snapshot: charge.workItemSnapshot }],
  })) as IInvoiceCharge[];
  for (const amount of [5000, -1000, 0]) charges.push({ item_id: `other-${amount}`, invoice_id: 'invoice', tenant: 'tenant', description: `Other ${amount}`, quantity: 1, unit_price: amount, net_amount: amount } as IInvoiceCharge);
  const vm: WasmInvoiceViewModel = { invoiceNumber: 'TEST', issueDate: '2026-09-01', dueDate: '2026-10-01', currencyCode: 'USD', customer: { name: 'Test', address: '' }, tenantClient: null,
    items: charges.map((c) => ({ id: c.item_id, description: c.description, quantity: c.quantity, unitPrice: c.unit_price, total: c.net_amount })), subtotal: charges.reduce((sum, c) => sum + c.net_amount, 0), tax: 1234, total: charges.reduce((sum, c) => sum + c.net_amount, 0) + 1234 };
  return { vm, charges, generated, inputs, taxContext };
}
function reconcile(vm: WasmInvoiceViewModel, charges: IInvoiceCharge[]) {
  const all = vm.ticketPresentationRows!.flatMap((row) => row.contributions);
  for (const charge of charges) {
    const contributions = all.filter((c) => c.itemId === charge.item_id);
    expect(contributions.length).toBeGreaterThan(0);
    expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(charge.net_amount);
    if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
  }
  expect(vm.ticketPresentationRows!.reduce((sum, row) => sum + row.amount, 0)).toBe(charges.reduce((sum, c) => sum + c.net_amount, 0));
}
const ast = getStandardTemplateAstByCode('standard-invoice-by-ticket')!;
describe('ticket presentation from actual calculation', () => {
  it('preserves public ticket and task identity through both contract normalization directions', () => {
    const { inputs, taxContext, generated } = fixture(22500, [{}, {
      work_item_type: 'project_task', work_item_id: 'task-a', project_task_name: 'Public task',
      ticket_number: null, ticket_title: null, ticket_description: null,
    }]);
    const normalized = normalizeResolvedContractCharge({ obligationId: 'time', tenantId: 'tenant',
      charge: { kind: 'hourly', executionMode: 'live', inputs, taxContext } });
    const result = calculateNormalizedContractCharge(normalized.obligation.facts, 'live', normalized.taxContext);
    expect(result.kind).toBe('hourly');
    if (result.kind !== 'hourly') throw new Error('Expected hourly calculation');
    expect(result.charges.map((charge) => charge.workItemSnapshot)).toEqual(generated.map((charge) => charge.workItemSnapshot));
    expect(result.charges[0].workItemSnapshot).toMatchObject({ title: 'Public title', description: 'Public description', rateKind: 'mixed' });
    expect(result.charges[1].workItemSnapshot).toMatchObject({ title: 'Public task', workItemId: 'task-a', ticketNumber: null });
  });
  it.each([
    { name: 'entry override', entry: { custom_rate: 17000 }, minutes: 60, amount: 17000, rate: 17000 },
    { name: 'catalog currency price', entry: { custom_rate: null, currency_rate: 13000 }, minutes: 60, amount: 13000, rate: 13000 },
    { name: 'user type price', entry: { custom_rate: null, user_type: 'engineer', currency_rate: 13000 }, minutes: 60, amount: 16000, rate: 16000 },
    { name: 'minimum duration', entry: { billable_duration: 10 }, minutes: 30, amount: 7500, rate: 15000 },
    { name: 'rounded duration', entry: { billable_duration: 31 }, minutes: 45, amount: 11250, rate: 15000 },
    { name: 'proven free time', entry: { custom_rate: 0 }, minutes: 60, amount: 0, rate: 0 },
    { name: 'phase override', entry: { project_id: 'project', project_phase_id: 'phase' }, minutes: 60, amount: 20000, rate: 20000 },
  ])('renders honest rate evidence for $name from actual calculation', async ({ entry, minutes, amount, rate }) => {
    const { vm, charges, generated, inputs, taxContext } = fixture(22500, [{ billable_duration: 60, ...entry }], (inputs) => {
      inputs.timeEntries = [inputs.timeEntries[0]];
      inputs.plan.enable_overtime = false;
      inputs.serviceConfigMap.set('service-0', { config: { config_id: 'hourly', hourly_rate: 15000, minimum_billable_time: 30, round_up_to_nearest: 15 }, userTypeRates: new Map([['engineer', 16000]]) });
      inputs.resolvePhaseRateOverride = (phaseId) => phaseId === 'phase' ? { rate: 20000, override_service_name: 'Phase service' } : null;
    });
    expect(generated[0].workItemSnapshot).toMatchObject({ billedMinutes: minutes, netAmount: amount, rateKind: 'uniform', uniformRate: rate });
    const normalized = normalizeResolvedContractCharge({ obligationId: 'rate', tenantId: 'tenant', charge: { kind: 'hourly', executionMode: 'live', inputs, taxContext } });
    expect(calculateNormalizedContractCharge(normalized.obligation.facts, 'live', taxContext).charges).toEqual(generated);
    attachInvoiceTimeCollections(vm, charges); reconcile(vm, charges);
    const evaluated = evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>);
    const { html } = await renderEvaluatedTemplateAst(ast, evaluated);
    expect(html).toContain(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(rate / 100));
    expect(html).toContain(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100));
  });
  it('renders zero-duration calculation as unknown without losing its zero charge', async () => {
    const { vm, charges, generated } = fixture(22500, [{ billable_duration: 0 }], (inputs) => {
      inputs.timeEntries = [inputs.timeEntries[0]];
    });
    expect(generated[0].total).toBe(0);
    expect(generated[0].workItemSnapshot).toMatchObject({ billedMinutes: 0, netAmount: 0, rateKind: 'unknown', uniformRate: null });
    attachInvoiceTimeCollections(vm, charges); reconcile(vm, charges);
    const { html } = await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>));
    expect(html).toContain('Rate unavailable');
    expect(html).toContain('$0.00');
  });
  it('preserves phase pricing and project cap ownership through normalized document calculation', async () => {
    const { inputs, taxContext } = fixture(22500, [0, 1, 2].map(() => ({
      work_item_type: 'project_task', work_item_id: 'task', project_id: 'project', project_phase_id: 'phase',
      project_task_name: 'Public task', ticket_number: null,
    })));
    inputs.resolvePhaseRateOverride = () => ({ rate: 20000, override_service_name: 'Phase service' });
    inputs.getProjectChargeConfig = () => ({ project_id: 'project', config_id: 'cap', billing_model: 'time_and_materials' });
    const direct = computeTimeBasedCharges(inputs, taxContext);
    const normalized = normalizeResolvedContractCharge({ obligationId: 'time', tenantId: 'tenant',
      charge: { kind: 'hourly', executionMode: 'live', inputs: { ...inputs, clientContractLine: { ...inputs.clientContractLine, tenant: 'tenant', currency_code: 'USD' } }, taxContext } });
    const roundtripped = calculateNormalizedContractCharge(normalized.obligation.facts, 'live', normalized.taxContext);
    expect(roundtripped.charges).toEqual(direct.charges);
    const { calculateContractBilling } = await import('@alga-psa/billing/lib/billing/domain/calculateContractBilling');
    const result = calculateContractBilling({ schemaVersion: 1,
      execution: { mode: 'live', tenantId: 'tenant', calculationId: 'cap-regression', asOf: '2026-09-01' },
      document: { clientId: 'client', currencyCode: 'USD', invoiceWindow: { start: '2026-08-01', endExclusive: '2026-09-01' } },
      obligations: [normalized.obligation], taxContexts: { [normalized.obligation.taxContextKey]: taxContext },
      projectCaps: { configsById: new Map([['cap', { config_id: 'cap', project_id: 'project', cap_amount: 20000, cap_notify_thresholds: [80] } as any]]), capUsageByConfigId: new Map() },
    });
    expect(result.subtotal).toBe(20000);
    expect(result.sourceCharges.reduce((sum, charge) => sum + charge.total, 0)).toBe(20000);
    expect(result.lines.reduce((sum, line) => sum + line.netAmount, 0)).toBe(20000);
    expect(result.sourceCharges.map((charge) => (charge as any).workItemSnapshot.netAmount)).toEqual(direct.charges.map((charge) => charge.workItemSnapshot!.netAmount));
    expect(result.projectCapThresholdCrossings).toEqual([{ configId: 'cap', projectId: 'project', threshold: 80, previousBilled: 0, newBilled: 20000 }]);
  });
  it('partitions charges and preserves both kinds of mixed evidence through HTML', async () => {
    const { vm, charges, generated } = fixture();
    const before = JSON.stringify({ items: vm.items, subtotal: vm.subtotal, tax: vm.tax, total: vm.total, charges });
    attachInvoiceTimeCollections(vm, charges); reconcile(vm, charges);
    expect(vm.ticketPresentationRows).toHaveLength(5);
    expect(generated[0].workItemSnapshot).toMatchObject({ version: 2, billedMinutes: 120, netAmount: 37500, rateKind: 'mixed', uniformRate: null });
    expect(vm.ticketGroups!.every((row) => row.rateKind === 'mixed' && row.rate === null)).toBe(true);
    const { html } = await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>));
    expect(html.match(/<table /g)).toHaveLength(1);
    for (const ticket of ['T-A', 'T-B']) expect(html.match(new RegExp(`${ticket} — Public title`, 'g'))).toHaveLength(1);
    expect(html).toContain('$375.00'); expect(html).toContain('Mixed rates');
    expect(html).not.toContain('$150.00'); expect(html).not.toContain('$187.50');
    expect(JSON.stringify({ items: vm.items, subtotal: vm.subtotal, tax: vm.tax, total: vm.total, charges })).toBe(before);
  });
  it('proves equal overtime rates and keeps persisted v1 unknown', () => {
    const { vm, charges, generated } = fixture(15000);
    expect(generated[0].workItemSnapshot).toMatchObject({ rateKind: 'uniform', uniformRate: 15000, netAmount: 30000 });
    const snapshot = { ...charges[0].time_entry_snapshots![0], version: 1 as const };
    charges[0].time_entry_links![0].snapshot = snapshot; charges[0].time_entry_snapshots = [snapshot];
    const frozen = JSON.stringify(snapshot); attachInvoiceTimeCollections(vm, charges);
    expect(vm.ticketGroups![0].rateKind).toBe('unknown'); expect(JSON.stringify(snapshot)).toBe(frozen); reconcile(vm, charges);
  });
  it.each(['partial', 'duplicate', 'conflict', 'wrong-tenant', 'invalid-money', 'unknown-version', 'cap', 'mixed-origin', 'legacy'])('retains whole charges on %s', (condition) => {
    const { vm, charges } = fixture(); const link = charges[0].time_entry_links![0];
    if (condition === 'partial') charges[0].time_entry_links!.push({ ...link, entryId: 'missing', snapshot: null });
    if (condition === 'duplicate') charges[0].time_entry_links!.push({ ...link });
    if (condition === 'conflict') charges[1].time_entry_links![0].entryId = link.entryId;
    if (condition === 'wrong-tenant') link.tenant = 'unrelated';
    if (condition === 'invalid-money') link.snapshot = { ...link.snapshot as object, netAmount: '37500' };
    if (condition === 'unknown-version') link.snapshot = { ...link.snapshot as object, version: 9 };
    if (condition === 'cap') { charges[0].net_amount -= 100; vm.items[0].total -= 100; }
    if (condition === 'mixed-origin') charges[0].billing_charge_type = 'fixed';
    if (condition === 'legacy') charges[0].time_entry_links = [{ ...link, snapshot: null }];
    attachInvoiceTimeCollections(vm, charges); reconcile(vm, charges);
    expect(vm.ticketPresentationRows!.find((r) => r.id === charges[0].item_id)?.amount).toBe(charges[0].net_amount);
    expect(vm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charges[0].item_id)).toHaveLength(1);
  });
  it('keeps separate task identities and ticketless time without inventing ticket labels', () => {
    const { vm, charges } = fixture(15000, [
      { work_item_type: 'project_task', work_item_id: 'task-a', project_task_name: 'Same task', ticket_number: null, ticket_title: null },
      { work_item_type: 'project_task', work_item_id: 'task-b', project_task_name: 'Same task', ticket_number: null, ticket_title: null },
      { work_item_type: null, work_item_id: null, ticket_number: null, ticket_title: null },
    ]);
    attachInvoiceTimeCollections(vm, charges); reconcile(vm, charges);
    expect(vm.ticketGroups!.map((g) => g.key)).toEqual(['task:task-a', 'task:task-b', 'ad_hoc']);
    expect(vm.ticketGroups![2].labelKey).toBe('time.other');
    expect(vm.ticketGroups!.every((g) => g.ticketNumber === null)).toBe(true);
  });
  it('preserves proven free time and mixed evidence alongside unavailable historical rates', () => {
    const { vm, charges, generated } = fixture(0, [{ custom_rate: 0 }]);
    expect(generated[0].workItemSnapshot).toMatchObject({ rateKind: 'uniform', uniformRate: 0, netAmount: 0 });
    attachInvoiceTimeCollections(vm, charges);
    expect(vm.ticketGroups![0]).toMatchObject({ rateKind: 'uniform', rate: 0 });
    const mixed = fixture();
    mixed.charges[1].time_entry_snapshots![0] = { ...mixed.charges[1].time_entry_snapshots![0], version: 1 };
    mixed.charges[1].time_entry_links![0].snapshot = mixed.charges[1].time_entry_snapshots![0];
    attachInvoiceTimeCollections(mixed.vm, mixed.charges);
    expect(mixed.vm.ticketGroups![1]).toMatchObject({ rateKind: 'unknown', rate: null });
    const knownMixed = fixture(22500, [{}, { work_item_id: 'ticket-a', ticket_number: 'T-A' }]);
    knownMixed.charges[1].time_entry_snapshots![0] = { ...knownMixed.charges[1].time_entry_snapshots![0], version: 1 };
    knownMixed.charges[1].time_entry_links![0].snapshot = knownMixed.charges[1].time_entry_snapshots![0];
    attachInvoiceTimeCollections(knownMixed.vm, knownMixed.charges);
    expect(knownMixed.vm.ticketGroups![0]).toMatchObject({ rateKind: 'mixed', rate: null });
    reconcile(knownMixed.vm, knownMixed.charges);
  });
  it.each(['group.entries', 'nestedEntries'])('roundtrips nested detail %s and resolves its declared parent row scope', async (bindingId) => {
    const { vm, charges } = fixture(); attachInvoiceTimeCollections(vm, charges);
    const nested = structuredClone(ast);
    nested.bindings!.collections!.nestedEntries = { id: 'nestedEntries', kind: 'collection', path: 'group.entries' };
    nested.layout.children = [{ id: 'ticket-region', type: 'stack', direction: 'column', repeat: { sourceBinding: { bindingId: 'ticketGroups' }, itemBinding: 'group' }, children: [
      { id: 'entry-detail', type: 'dynamic-table', repeat: { sourceBinding: { bindingId }, itemBinding: 'entry' }, columns: [
        { id: 'hours', header: 'Hours', value: { type: 'path', path: 'entry.hours' }, format: 'number' },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'entry.amount' }, format: 'currency' },
      ] },
    ] }];
    const reopened = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(nested));
    expect((reopened.layout.children[0] as any).children[0].repeat.sourceBinding.bindingId).toBe(bindingId);
    const scope = resolveCanvasRowScope(vm, reopened, 'entry-detail');
    expect(resolveCanvasCollection(vm, bindingId, reopened, scope).rows).toEqual(vm.ticketGroups![0].entries);
    expect(resolveTableItemBindingRawValue(vm, resolveCanvasCollection(vm, bindingId, reopened, scope).rows[0], 'line.amount', 'line')).toBe(37500);
    const { html } = await renderEvaluatedTemplateAst(reopened, evaluateTemplateAst(reopened, vm as unknown as Record<string, unknown>));
    expect(html).toContain('$375.00'); expect(html).toContain('$180.00');
    const legacy = { ...vm, ticketGroups: undefined, timeEntries: undefined };
    expect(resolveCanvasCollection(legacy, bindingId, reopened, resolveCanvasRowScope(legacy, reopened, 'entry-detail'))).toEqual({ rows: [] });
    const customBindingAst = { ...ast, bindings: { ...ast.bindings, collections: { ...ast.bindings!.collections, savedPrimary: { id: 'savedPrimary', kind: 'collection' as const, path: 'ticketPresentationRows' } } } };
    expect(resolveCollectionDescriptor('savedPrimary', undefined, customBindingAst)?.fields.map((f) => f.name)).toContain('rateKind');
  });
  it('resolves sorted/empty rows with discoverable fields and French semantic labels', () => {
    const { vm, charges } = fixture(); attachInvoiceTimeCollections(vm, charges);
    const sorted = { ...ast, transforms: { sourceBindingId: 'timeEntries', outputBindingId: 'sortedTime', operations: [{ id: 'sort', type: 'sort' as const, keys: [{ path: 'amount', direction: 'desc' as const }] }] } };
    const rows = resolveCanvasCollection(vm, 'sortedTime', sorted); expect(rows.diagnostic).toBeUndefined();
    expect(rows.rows.map((r) => r.amount)).toEqual([...vm.timeEntries!].sort((a,b) => b.amount-a.amount).map((e) => e.amount));
    expect(resolveCollectionDescriptor('sortedTime', sorted.transforms)?.fields.some((f) => f.name === 'rateKind')).toBe(true);
    expect(resolveCanvasCollection({ ...vm, timeEntries: [] }, 'sortedTime', sorted).rows).toEqual([]);
    expect(resolveCanvasCollection(vm, 'missing', sorted).diagnostic).toContain('missing');
    expect(resolveCanvasCollection(vm, 'timeEntries', null).diagnostic).toBeTruthy();
    expect(resolveCanvasCollection({ ...vm, timeEntries: undefined }, 'sortedTime', sorted)).toEqual({ rows: [] });
    const t = (key: string, options: { defaultValue: string }) => key.split('.').reduce<any>((o, part) => o?.[part], fr) ?? options.defaultValue;
    const localized = localizeTimePresentation(evaluateTemplateAst(sorted, vm as unknown as Record<string, unknown>), t);
    expect((localized.bindings.sortedTime as any[])[0].rateDisplay).toBe('Tarifs variables');
    expect(vm.timeEntries![0].rateDisplay).toBeNull();
  });
  it('uses evaluator filter/group output schemas without suggesting entry fields on group wrappers', () => {
    const { vm, charges } = fixture(); attachInvoiceTimeCollections(vm, charges);
    const filtered: TemplateAst = { ...ast, transforms: { sourceBindingId: 'timeEntries', outputBindingId: 'selectedTime', operations: [
      { id: 'filter', type: 'filter', predicate: { type: 'comparison', path: 'amount', op: 'gt', value: 18000 } },
    ] } };
    const selected = resolveCanvasCollection(vm, 'selectedTime', filtered);
    expect(selected.rows.map((row) => row.amount)).toEqual([37500]);
    expect(resolveCollectionDescriptor('selectedTime', filtered.transforms, filtered)?.fields.map((field) => field.name)).toContain('rateKind');
    const grouped: TemplateAst = { ...filtered, transforms: { ...filtered.transforms!, operations: [
      { id: 'group', type: 'group', key: 'workItemId' },
      { id: 'sum', type: 'aggregate', aggregations: [{ id: 'net', op: 'sum', path: 'amount' }] },
    ] } };
    const rows = resolveCanvasCollection(vm, 'selectedTime', grouped).rows;
    expect(rows.map((row: any) => row.aggregates.net)).toEqual([37500, 33000]);
    const descriptor = resolveCollectionDescriptor('selectedTime', grouped.transforms, grouped)!;
    expect(descriptor.fields.map((field) => field.name)).toEqual(['key', 'items', 'aggregates.net']);
    expect(descriptor.presets(((_key: string) => '') as any)).toEqual([]);
    expect(descriptor.nested?.items.fields.map((field) => field.name)).toContain('rateKind');
    const invalid: TemplateAst = { ...grouped, transforms: { ...grouped.transforms!, operations: [...grouped.transforms!.operations,
      { id: 'invalid-sort', type: 'sort', keys: [{ path: 'amount', direction: 'asc' }] },
    ] } };
    expect(resolveCanvasCollection(vm, 'selectedTime', invalid)).toMatchObject({ rows: [], diagnostic: expect.stringContaining('cannot run after grouped output') });
  });

  it.each(['invoiceNumber', 'missing.path'])('diagnoses declared invalid collection %s on canvas and render after reopening', async (path) => {
    const { vm, charges } = fixture(); attachInvoiceTimeCollections(vm, charges);
    const invalid = structuredClone(ast);
    invalid.bindings!.collections!.bad = { id: 'bad', kind: 'collection', path };
    invalid.layout.children = [{ id: 'bad-table', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'bad' }, itemBinding: 'entry' }, columns: [
      { id: 'amount', header: 'Amount', value: { type: 'path', path: 'entry.amount' }, format: 'currency' },
    ] }];
    const reopened = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(invalid));
    expect(resolveCanvasCollection(vm, 'bad', reopened)).toMatchObject({ rows: [], diagnostic: expect.stringContaining(path) });
    await expect(renderEvaluatedTemplateAst(reopened, evaluateTemplateAst(reopened, vm as any))).rejects.toThrow(path);
    for (const empty of [{ ...vm, [path]: [] }, { ...vm, timeEntries: undefined }]) {
      const valid = structuredClone(reopened);
      valid.bindings!.collections!.bad.path = 'timeEntries' in empty && empty.timeEntries === undefined ? 'timeEntries' : 'empty';
      const data = { ...empty, empty: [] };
      expect(resolveCanvasCollection(data, 'bad', valid)).toEqual({ rows: [] });
      expect((await renderEvaluatedTemplateAst(valid, evaluateTemplateAst(valid, data as any))).html).not.toContain('$375.00');
    }
  });
  it.each(['rateDisplay', 'label'])('filters and sorts %s on identical neutral data before translating', async (path) => {
    const { vm, charges } = fixture(); attachInvoiceTimeCollections(vm, charges);
    const t = (key: string, options: { defaultValue: string }) => key.split('.').reduce<any>((o, part) => o?.[part], fr) ?? options.defaultValue;
    for (const operation of [
      { id: 'filter', type: 'filter', predicate: { type: 'comparison', path, op: 'eq', value: 'Tarifs variables' } },
      { id: 'filter-semantic', type: 'filter', predicate: { type: 'comparison', path: 'rateKind', op: 'eq', value: 'mixed' } },
      { id: 'sort-asc', type: 'sort', keys: [{ path, direction: 'asc' }] },
      { id: 'sort-desc', type: 'sort', keys: [{ path, direction: 'desc' }] },
    ]) {
      const transformed = { ...ast, transforms: { sourceBindingId: 'timeEntries', outputBindingId: 'selected', operations: [operation] } } as TemplateAst;
      const expected = localizeTimePresentation(evaluateTemplateAst(transformed, vm as any), t).bindings.selected;
      expect(localizeTimePresentation(resolveCanvasCollection(vm, 'selected', transformed).rows, t)).toEqual(expected);
      expect(localizeTimePresentation(resolveCanvasCollection(localizeTimePresentation(vm, t), 'selected', transformed).rows, t)).toEqual(expected);
      if (operation.id === 'filter') expect(expected).toEqual([]);
      if (operation.id === 'filter-semantic') expect((expected as any[])[0].rateDisplay).toBe('Tarifs variables');
      transformed.layout = { id: 'document', type: 'document', children: [{ id: 'selected', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'selected' }, itemBinding: 'entry' }, columns: [
        { id: 'id', header: 'Entry', value: { type: 'path', path: 'entry.id' } },
        { id: 'rate', header: 'Rate', value: { type: 'path', path: 'entry.rateDisplay' }, format: 'currency' },
      ] }] };
      const { html } = await renderEvaluatedTemplateAst(transformed, evaluateTemplateAst(transformed, vm as any), { locale: 'fr', t });
      const renderedIds = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].filter((_match, index) => index % 2 === 0).map((match) => match[1]).filter(Boolean);
      expect(renderedIds).toEqual((expected as any[]).map((row) => row.id));
    }
  });
  it.each(['quote', 'sales-order'] as const)('renders discovered presets from saved %s bindings using that document’s row fields', async (kind) => {
    const bindings = kind === 'quote' ? buildQuoteTemplateBindings() : buildSalesOrderTemplateBindings();
    const template: TemplateAst = { ...ast, bindings, layout: { id: 'document', type: 'document', children: [] } };
    const source = kind === 'quote' ? 'serviceItems' : 'lineItems';
    const descriptor = resolveCollectionDescriptor(source, undefined, template)!;
    const presets = descriptor.presets(((_key: string, options: any) => options.defaultValue) as any);
    template.layout.children = [{ id: 'items', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: source }, itemBinding: 'item' },
      columns: presets.map((preset) => ({ id: preset.id, header: preset.header, value: { type: 'path' as const, path: preset.key }, format: preset.type as 'text' | 'number' | 'currency' })),
    }];
    const reopened = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(template));
    const model = { currencyCode: 'USD', service_items: [{ description: 'Quote service', quantity: 2, unit_price: 15000, total_price: 30000 }],
      line_items: [{ description: 'Ordered product', quantity_ordered: 3, unit_price: 15000, amount: 45000 }] };
    const { html } = await renderEvaluatedTemplateAst(reopened, evaluateTemplateAst(reopened, model));
    expect(html).toContain(kind === 'quote' ? 'Quote service' : 'Ordered product');
    expect(html).toContain(kind === 'quote' ? '$300.00' : '$450.00');
    expect(resolveCanvasCollection(model as unknown as WasmInvoiceViewModel, source, reopened).rows).toHaveLength(1);
  });
});
