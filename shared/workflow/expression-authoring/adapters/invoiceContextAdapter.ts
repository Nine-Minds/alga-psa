import type { SharedExpressionContextRoot, SharedExpressionSchemaNode, SharedExpressionPathOption } from '../context';
import type { ExpressionMode } from '../modes';
import { buildPathOptionsFromContextRoots } from '../pathDiscovery';

const createInvoiceRootSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    number: { type: 'string', description: 'Primary invoice identifier.' },
    issueDate: { type: 'string', description: 'Date the invoice was issued.' },
    dueDate: { type: 'string', description: 'Date the invoice is due.' },
    recurringServicePeriodStart: {
      type: 'string',
      description: 'Canonical recurring invoice service period start date when available.',
    },
    recurringServicePeriodEnd: {
      type: 'string',
      description: 'Canonical recurring invoice service period end date when available.',
    },
    recurringServicePeriodLabel: {
      type: 'string',
      description: 'Formatted canonical recurring invoice service period label when available.',
    },
    poNumber: { type: 'string', description: 'Purchase order number.' },
    subtotal: { type: 'number', description: 'Subtotal before tax and discounts.' },
    tax: { type: 'number', description: 'Tax amount.' },
    total: { type: 'number', description: 'Final invoice total.' },
    currencyCode: { type: 'string', description: 'Invoice currency code.' },
  },
  required: ['number', 'total'],
});

const createPartySchema = (label: string): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    name: { type: 'string', description: `${label} display name.` },
    address: { type: 'string', description: `${label} address.` },
  },
});

const createItemSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Line item description.' },
    quantity: { type: 'number', description: 'Line item quantity.' },
    unitPrice: { type: 'number', description: 'Line item unit price.' },
    total: { type: 'number', description: 'Line item total.' },
    servicePeriodStart: { type: 'string', description: 'Line item recurring service period start date when available.' },
    servicePeriodEnd: { type: 'string', description: 'Line item recurring service period end date when available.' },
    billingTiming: { type: 'string', description: 'Line item billing timing when available.' },
  },
});

/**
 * The invoice roots below are the default menu. Document types whose fields live in a binding
 * catalog (quote, sales order, and the packing slip / pick list that reuse it) inject generated
 * roots through `contextRoots` — those catalogs live in packages/billing, and the dependency only
 * ever runs billing -> shared.
 */
export const buildInvoiceExpressionContextRoots = (params: {
  contextRoots?: SharedExpressionContextRoot[];
} = {}): SharedExpressionContextRoot[] => {
  if (params.contextRoots && params.contextRoots.length > 0) {
    return params.contextRoots;
  }

  return [
    {
      key: 'invoice',
      label: 'Invoice',
      description: 'Invoice-level fields',
      schema: createInvoiceRootSchema(),
      allowInModes: ['path-only', 'template'],
    },
    {
      key: 'customer',
      label: 'Customer',
      description: 'Customer fields',
      schema: createPartySchema('Customer'),
      allowInModes: ['path-only', 'template'],
    },
    {
      key: 'tenant',
      label: 'Tenant',
      description: 'Tenant fields',
      schema: createPartySchema('Tenant'),
      allowInModes: ['path-only', 'template'],
    },
    {
      key: 'item',
      label: 'Line Item',
      description: 'Line item fields for repeating/table contexts',
      schema: createItemSchema(),
      allowInModes: ['path-only', 'template'],
    },
  ];
};

export const buildInvoiceExpressionPathOptions = (params: {
  mode?: ExpressionMode;
  includeRootPaths?: boolean;
  contextRoots?: SharedExpressionContextRoot[];
} = {}): SharedExpressionPathOption[] =>
  buildPathOptionsFromContextRoots(
    buildInvoiceExpressionContextRoots({ contextRoots: params.contextRoots }),
    params
  );
