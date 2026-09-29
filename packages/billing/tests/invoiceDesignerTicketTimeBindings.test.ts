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
      'item.rateDisplay',
      'item.totalAmount',
    ]);
    // Rate presentation stays honest: rateDisplay is the uniform minor-unit
    // rate (currency column formats it with the render locale) or the
    // "Mixed rates" text when entries differ — never a blended figure and
    // never money pre-formatted with a hardcoded locale.
    expect(presets.find((preset) => preset.key === 'item.rateDisplay')?.type).toBe('currency');
  });

  it('offers per-entry preset columns for timeEntries tables', () => {
    const presets = resolveColumnPresetsForBinding(t, 'timeEntries');
    expect(presets.map((preset) => preset.key)).toEqual([
      'item.date',
      'item.ticketNumber',
      'item.title',
      'item.hours',
      'item.rateDisplay',
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

});
