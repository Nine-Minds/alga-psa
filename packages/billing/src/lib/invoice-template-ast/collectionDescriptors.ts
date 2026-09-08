import type { TFunction } from 'i18next';
import type { TemplateAst, TemplateTransformPipeline } from '@alga-psa/types';
type ColumnPreset = {
  id: string;
  label: string;
  header: string;
  key: string;
  type: string;
  width: number;
  description: string;
};

/**
 * Quick-add columns for tables bound to the `ticketGroups` collection —
 * the rolled-up "Ticket | Description | Hours | Rate | Amount" presentation
 * (one row per ticket). Rate uses `item.rateDisplay`: the uniform hourly rate
 * (currency-formatted with the render locale) or "Mixed rates" when a ticket
 * bills at more than one rate — never a blended figure.
 */
export const buildTicketGroupColumnPresets = (t: TFunction): ColumnPreset[] => [
  {
    id: 'ticket',
    label: t('invoiceDesigner.tableEditor.presets.ticket.label', { defaultValue: 'Ticket' }),
    header: t('invoiceDesigner.tableEditor.presets.ticket.label', { defaultValue: 'Ticket' }),
    key: 'item.label',
    type: 'text',
    width: 200,
    description: t('invoiceDesigner.tableEditor.presets.ticket.hint', { defaultValue: 'Ticket number and title' }),
  },
  {
    id: 'ticket-description',
    label: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    header: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    key: 'item.description',
    type: 'text',
    width: 240,
    description: t('invoiceDesigner.tableEditor.presets.ticketDescription.hint', { defaultValue: 'Customer-visible ticket description' }),
  },
  {
    id: 'ticket-hours',
    label: t('invoiceDesigner.tableEditor.presets.hours.label', { defaultValue: 'Hours' }),
    header: t('invoiceDesigner.tableEditor.presets.hours.label', { defaultValue: 'Hours' }),
    key: 'item.totalHours',
    type: 'number',
    width: 90,
    description: t('invoiceDesigner.tableEditor.presets.ticketHours.hint', { defaultValue: 'Total billed hours for the ticket' }),
  },
  {
    id: 'ticket-rate',
    label: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    header: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    key: 'item.rateDisplay',
    type: 'currency',
    width: 110,
    description: t('invoiceDesigner.tableEditor.presets.ticketRate.hint', { defaultValue: 'Hourly rate ("Mixed rates" when entries differ)' }),
  },
  {
    id: 'ticket-amount',
    label: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    header: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    key: 'item.totalAmount',
    type: 'currency',
    width: 140,
    description: t('invoiceDesigner.tableEditor.presets.ticketAmount.hint', { defaultValue: 'Total billed amount for the ticket' }),
  },
];

/** Quick-add columns for tables bound to the flat `timeEntries` collection. */
export const buildTimeEntryColumnPresets = (t: TFunction): ColumnPreset[] => [
  {
    id: 'entry-date',
    label: t('invoiceDesigner.tableEditor.presets.date.label', { defaultValue: 'Date' }),
    header: t('invoiceDesigner.tableEditor.presets.date.label', { defaultValue: 'Date' }),
    key: 'item.date',
    type: 'date',
    width: 110,
    description: t('invoiceDesigner.tableEditor.presets.entryDate.hint', { defaultValue: 'Date the work was performed' }),
  },
  {
    id: 'entry-ticket',
    label: t('invoiceDesigner.tableEditor.presets.ticket.label', { defaultValue: 'Ticket' }),
    header: t('invoiceDesigner.tableEditor.presets.ticket.label', { defaultValue: 'Ticket' }),
    key: 'item.ticketNumber',
    type: 'text',
    width: 120,
    description: t('invoiceDesigner.tableEditor.presets.entryTicket.hint', { defaultValue: 'Source ticket number' }),
  },
  {
    id: 'entry-title',
    label: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    header: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    key: 'item.title',
    type: 'text',
    width: 220,
    description: t('invoiceDesigner.tableEditor.presets.entryTitle.hint', { defaultValue: 'Ticket title or task name' }),
  },
  {
    id: 'entry-hours',
    label: t('invoiceDesigner.tableEditor.presets.hours.label', { defaultValue: 'Hours' }),
    header: t('invoiceDesigner.tableEditor.presets.hours.label', { defaultValue: 'Hours' }),
    key: 'item.hours',
    type: 'number',
    width: 90,
    description: t('invoiceDesigner.tableEditor.presets.entryHours.hint', { defaultValue: 'Billed hours for the entry' }),
  },
  {
    id: 'entry-rate',
    label: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    header: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    key: 'item.rateDisplay',
    type: 'currency',
    width: 110,
    description: t('invoiceDesigner.tableEditor.presets.entryRate.hint', { defaultValue: 'Hourly rate for the entry' }),
  },
  {
    id: 'entry-amount',
    label: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    header: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    key: 'item.amount',
    type: 'currency',
    width: 140,
    description: t('invoiceDesigner.tableEditor.presets.entryAmount.hint', { defaultValue: 'Billed amount for the entry' }),
  },
];

/** Column presets appropriate for the table's bound collection. */
export const resolveColumnPresetsForBinding = (
  t: TFunction,
  sourceBindingId: string
): ColumnPreset[] => {
  if (sourceBindingId === 'ticketGroups') {
    return buildTicketGroupColumnPresets(t);
  }
  if (sourceBindingId === 'timeEntries') {
    return buildTimeEntryColumnPresets(t);
  }
  return buildColumnPresets(t);
};

/** Extra binding-key suggestions per collection, beyond the preset keys. */
export const resolveExtraBindingKeySuggestions = (sourceBindingId: string): string[] => {
  if (sourceBindingId === 'ticketGroups') {
    return [
      'item.ticketNumber',
      'item.title',
      'item.dateStart',
      'item.dateEnd',
      'item.entryCount',
      'item.rate',
      'item.hasMixedRates',
    ];
  }
  if (sourceBindingId === 'timeEntries') {
    return ['item.description', 'item.serviceName', 'item.billedMinutes'];
  }
  return ['item.servicePeriodStart', 'item.servicePeriodEnd', 'item.billingTiming'];
};

// Preset ids, binding keys, types and widths are the data contract; only labels are translated.
const buildColumnPresets = (t: TFunction): ColumnPreset[] => [
  {
    id: 'description',
    label: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    header: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    key: 'item.description',
    type: 'text',
    width: 280,
    description: t('invoiceDesigner.tableEditor.presets.description.hint', { defaultValue: 'Line item description' }),
  },
  {
    id: 'quantity',
    label: t('invoiceDesigner.tableEditor.presets.quantity.label', { defaultValue: 'Qty' }),
    header: t('invoiceDesigner.tableEditor.presets.quantity.label', { defaultValue: 'Qty' }),
    key: 'item.quantity',
    type: 'number',
    width: 90,
    description: t('invoiceDesigner.tableEditor.presets.quantity.hint', { defaultValue: 'Quantity' }),
  },
  {
    id: 'unit-price',
    label: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    header: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    key: 'item.unitPrice',
    type: 'currency',
    width: 120,
    description: t('invoiceDesigner.tableEditor.presets.unitPrice.hint', { defaultValue: 'Unit price' }),
  },
  {
    id: 'amount',
    label: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    header: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    key: 'item.total',
    type: 'currency',
    width: 140,
    description: t('invoiceDesigner.tableEditor.presets.amount.hint', { defaultValue: 'Line total' }),
  },
];


export type CollectionField = { name: string; type: 'string' | 'number' | 'boolean' | 'array' | 'object' };
export type CollectionDescriptor = {
  documentKind?: 'invoice' | 'quote' | 'sales-order';
  id: string;
  path: string;
  fields: CollectionField[];
  presets: (t: TFunction) => ColumnPreset[];
  nested?: Record<string, CollectionDescriptor>;
};
const fields = (names: string[], numeric: string[] = []): CollectionField[] => names.map((name) => ({ name, type: numeric.includes(name) ? 'number' : 'string' }));
const entry: CollectionDescriptor = {
  documentKind: 'invoice', id: 'timeEntries', path: 'timeEntries', presets: buildTimeEntryColumnPresets,
  fields: fields(['label', 'ticketNumber', 'title', 'description', 'date', 'hours', 'billedMinutes', 'rate', 'rateKind', 'rateDisplay', 'amount', 'serviceName'], ['hours', 'billedMinutes', 'rate', 'amount']),
};
const ticket: CollectionDescriptor = {
  documentKind: 'invoice', id: 'ticketGroups', path: 'ticketGroups', presets: buildTicketGroupColumnPresets,
  fields: [...fields(['label', 'ticketNumber', 'title', 'description', 'dateStart', 'dateEnd', 'totalHours', 'totalMinutes', 'totalAmount', 'rate', 'rateDisplay', 'rateKind', 'entryCount'], ['totalHours', 'totalMinutes', 'totalAmount', 'rate', 'entryCount']), { name: 'entries', type: 'array' }],
  nested: { entries: entry },
};
const primary: CollectionDescriptor = {
  documentKind: 'invoice', id: 'ticketPresentationRows', path: 'ticketPresentationRows',
  fields: fields(['label', 'description', 'quantity', 'rate', 'rateKind', 'rateDisplay', 'amount', 'servicePeriodStart', 'servicePeriodEnd'], ['quantity', 'rate', 'amount']),
  presets: (t) => buildTicketGroupColumnPresets(t).map((preset) => ({ ...preset, key: preset.key.replace('totalHours', 'quantity').replace('totalAmount', 'amount') })),
};
const items: CollectionDescriptor = {
  documentKind: 'invoice', id: 'lineItems', path: 'items', presets: buildColumnPresets,
  fields: fields(['description', 'quantity', 'unitPrice', 'total', 'servicePeriodStart', 'servicePeriodEnd', 'billingTiming'], ['quantity', 'unitPrice', 'total']),
};
export const INVOICE_COLLECTION_DESCRIPTORS = [items, ticket, entry, primary];

// The other document editors share the table inspector. Preserve their actual
// row schema instead of offering invoice fields on snake-case document rows.
const documentItems = (kind: 'quote' | 'sales-order'): CollectionDescriptor => {
  const quantity = kind === 'quote' ? 'quantity' : 'quantity_ordered';
  const amount = kind === 'quote' ? 'total_price' : 'amount';
  return {
    documentKind: kind, id: 'lineItems', path: 'line_items',
    fields: fields(['description', quantity, 'unit_price', amount], [quantity, 'unit_price', amount]),
    presets: (t) => buildColumnPresets(t).map((preset) => ({
      ...preset,
      key: preset.key.replace('quantity', quantity).replace('unitPrice', 'unit_price').replace('total', amount),
    })),
  };
};

/** Schemas follow evaluator semantics, independently of sample row presence. */
export function resolveCollectionDescriptor(id: string, transforms?: TemplateTransformPipeline, ast?: TemplateAst): CollectionDescriptor | undefined {
  const path = ast?.bindings?.collections?.[id]?.path ?? id;
  if (transforms && id === transforms.outputBindingId && transforms.sourceBindingId !== id) {
    let result = resolveCollectionDescriptor(transforms.sourceBindingId, undefined, ast);
    for (const op of transforms.operations) {
      if (op.type === 'group') {
        result = { id, path: id, fields: [{ name: 'key', type: 'string' }, { name: 'items', type: 'array' }], presets: () => [], nested: result ? { items: result } : undefined };
      } else if (op.type === 'aggregate' && result?.nested?.items) {
        result = { ...result, fields: [...result.fields, ...op.aggregations.map((a): CollectionField => ({ name: `aggregates.${a.id}`, type: 'number' }))] };
      } else if (op.type === 'computed-field' && result) {
        result = { ...result, fields: [...result.fields, ...op.fields.map((f): CollectionField => ({ name: f.id, type: 'number' }))] };
      }
      // Ungrouped aggregate leaves the row output intact; its values live in aggregates.
    }
    return result;
  }
  if (['group.items', 'item.items'].includes(path) && transforms?.operations.some((op) => op.type === 'group')) {
    return resolveCollectionDescriptor(transforms.sourceBindingId, undefined, ast);
  }
  if (['items', 'lineItems', 'recurringItems', 'onetimeItems'].includes(path)) return items;
  if (path === 'group.items' && ast?.bindings?.collections?.lineItems?.path !== 'line_items') return items;
  if (['line_items', 'recurring_items', 'onetime_items', 'service_items', 'product_items', 'phase.items', 'group.items'].includes(path)) {
    return documentItems(ast?.bindings?.values?.orderNumber ? 'sales-order' : 'quote');
  }
  if (path === 'group.entries' || path === 'item.entries' || path === 'entries') return entry;
  return INVOICE_COLLECTION_DESCRIPTORS.find((descriptor) => descriptor.path === path);
}

// Binding ids are the data contract; only their display labels are translated.
export const buildCollectionBindingLabels = (t: TFunction): Record<string, string> => ({
  lineItems: t('invoiceDesigner.tableEditor.bindings.lineItems', { defaultValue: 'All Line Items' }),
  phases: t('invoiceDesigner.tableEditor.bindings.phases', { defaultValue: 'Phases' }),
  recurringItems: t('invoiceDesigner.tableEditor.bindings.recurringItems', { defaultValue: 'Recurring Items' }),
  onetimeItems: t('invoiceDesigner.tableEditor.bindings.onetimeItems', { defaultValue: 'One-time Items' }),
  serviceItems: t('invoiceDesigner.tableEditor.bindings.serviceItems', { defaultValue: 'Service Items' }),
  productItems: t('invoiceDesigner.tableEditor.bindings.productItems', { defaultValue: 'Product Items' }),
  items: t('invoiceDesigner.tableEditor.bindings.items', { defaultValue: 'Items' }),
  ticketGroups: t('invoiceDesigner.tableEditor.bindings.ticketGroups', { defaultValue: 'Billed Time by Ticket' }),
  ticketPresentationRows: t('invoiceDesigner.tableEditor.bindings.ticketPresentationRows', { defaultValue: 'Charges by Ticket' }),
  timeEntries: t('invoiceDesigner.tableEditor.bindings.timeEntries', { defaultValue: 'Billed Time Entries' }),
});

export const humanizeCollectionBindingLabel = (bindingId: string, _path: string, t: TFunction): string => {
  return buildCollectionBindingLabels(t)[bindingId] ?? bindingId;
};
