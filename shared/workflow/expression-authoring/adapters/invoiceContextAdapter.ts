import type { SharedExpressionContextRoot, SharedExpressionSchemaNode, SharedExpressionPathOption } from '../context';
import type { ExpressionMode } from '../modes';
import { buildPathOptionsFromContextRoots } from '../pathDiscovery';

const createInvoiceRootSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    number: { type: 'string', description: 'Primary invoice identifier.' },
    issueDate: { type: 'string', description: 'Date the invoice was issued.' },
    dueDate: { type: 'string', description: 'Date the invoice is due.' },
    poNumber: { type: 'string', description: 'Purchase order number.' },
    subtotal: { type: 'number', description: 'Subtotal before tax and discounts.' },
    tax: { type: 'number', description: 'Tax amount.' },
    discount: { type: 'number', description: 'Discount amount.' },
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
  },
});

export const buildInvoiceExpressionContextRoots = (): SharedExpressionContextRoot[] => [
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

export const buildInvoiceExpressionPathOptions = (params: {
  mode?: ExpressionMode;
  includeRootPaths?: boolean;
} = {}): SharedExpressionPathOption[] =>
  buildPathOptionsFromContextRoots(buildInvoiceExpressionContextRoots(), params);
