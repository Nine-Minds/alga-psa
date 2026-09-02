import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  buildTicketGroupColumnPresets,
  buildTimeEntryColumnPresets,
  resolveColumnPresetsForBinding,
  resolveExtraBindingKeySuggestions,
} from '../src/components/invoice-designer/inspector/widgets/TableEditorWidget';
import { buildInvoiceTemplateBindings } from '../src/lib/invoice-template-ast/standardTemplates';

const t = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as unknown as TFunction;

describe('invoice designer: billed-time collection discoverability', () => {
  it('publishes ticketGroups and timeEntries in the canonical invoice collection catalog', () => {
    const collections = buildInvoiceTemplateBindings().collections ?? {};
    expect(collections.ticketGroups).toMatchObject({ kind: 'collection', path: 'ticketGroups' });
    expect(collections.timeEntries).toMatchObject({ kind: 'collection', path: 'timeEntries' });
  });

  it('offers the Ticket | Description | Hours | Rate | Amount preset columns for ticketGroups tables', () => {
    const presets = resolveColumnPresetsForBinding(t, 'ticketGroups');
    expect(presets.map((preset) => preset.header)).toEqual([
      'Ticket',
      'Description',
      'Hours',
      'Rate',
      'Amount',
    ]);
    expect(presets.map((preset) => preset.key)).toEqual([
      'item.label',
      'item.description',
      'item.totalHours',
      'item.rateLabel',
      'item.totalAmount',
    ]);
    // Rate presentation stays honest: rateLabel is text ("Mixed rates"
    // when entries differ), never a blended currency value.
    expect(presets.find((preset) => preset.key === 'item.rateLabel')?.type).toBe('text');
  });

  it('offers per-entry preset columns for timeEntries tables', () => {
    const presets = resolveColumnPresetsForBinding(t, 'timeEntries');
    expect(presets.map((preset) => preset.key)).toEqual([
      'item.date',
      'item.ticketNumber',
      'item.title',
      'item.hours',
      'item.rate',
      'item.amount',
    ]);
  });

  it('keeps the classic line-item presets for other collections', () => {
    const presets = resolveColumnPresetsForBinding(t, 'lineItems');
    expect(presets.map((preset) => preset.key)).toEqual([
      'item.description',
      'item.quantity',
      'item.unitPrice',
      'item.total',
    ]);
  });

  it('suggests the remaining snapshot fields as binding keys', () => {
    expect(resolveExtraBindingKeySuggestions('ticketGroups')).toEqual(
      expect.arrayContaining(['item.ticketNumber', 'item.dateStart', 'item.hasMixedRates']),
    );
    expect(resolveExtraBindingKeySuggestions('timeEntries')).toEqual(
      expect.arrayContaining(['item.description', 'item.serviceName', 'item.billedMinutes']),
    );
    // Non-time tables keep the recurring-period suggestions untouched.
    expect(resolveExtraBindingKeySuggestions('lineItems')).toEqual([
      'item.servicePeriodStart',
      'item.servicePeriodEnd',
      'item.billingTiming',
    ]);
  });

  it('exposes every preset key on the underlying collection row shapes', () => {
    const groupPresetFields = buildTicketGroupColumnPresets(t).map((preset) =>
      preset.key.replace(/^item\./, ''),
    );
    const entryPresetFields = buildTimeEntryColumnPresets(t).map((preset) =>
      preset.key.replace(/^item\./, ''),
    );

    const groupShape: Record<string, unknown> = {
      key: 'ticket:1', workItemType: 'ticket', workItemId: '1', ticketNumber: 'T-1',
      title: 't', description: 'd', label: 'l', dateStart: null, dateEnd: null,
      totalMinutes: 0, totalHours: 0, totalAmount: 0, hasMixedRates: false,
      rate: null, rateLabel: '', entryCount: 0, entries: [],
    };
    const entryShape: Record<string, unknown> = {
      id: 'e', itemId: null, workItemType: 'ticket', workItemId: '1', ticketNumber: 'T-1',
      title: 't', description: 'd', date: null, billedMinutes: 0, hours: 0,
      rate: 0, amount: 0, serviceId: null, serviceName: null,
    };

    for (const field of groupPresetFields) {
      expect(groupShape).toHaveProperty(field);
    }
    for (const field of entryPresetFields) {
      expect(entryShape).toHaveProperty(field);
    }
  });
});
