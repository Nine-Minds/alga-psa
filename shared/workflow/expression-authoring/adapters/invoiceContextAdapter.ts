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
    servicePeriodStart: { type: 'string', description: 'Line item recurring service period start date when available.' },
    servicePeriodEnd: { type: 'string', description: 'Line item recurring service period end date when available.' },
    billingTiming: { type: 'string', description: 'Line item billing timing when available.' },
  },
});

const createQuoteRootSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    quoteNumber: { type: 'string', description: 'Primary quote identifier.' },
    quoteDate: { type: 'string', description: 'Date the quote was issued.' },
    validUntil: { type: 'string', description: 'Quote expiration date.' },
    status: { type: 'string', description: 'Current quote status.' },
    title: { type: 'string', description: 'Quote title.' },
    scope: { type: 'string', description: 'Scope of work.' },
    poNumber: { type: 'string', description: 'Purchase order number.' },
    subtotal: { type: 'number', description: 'Quote subtotal before tax.' },
    discountTotal: { type: 'number', description: 'Discount amount.' },
    tax: { type: 'number', description: 'Quote tax amount.' },
    total: { type: 'number', description: 'Final quote total.' },
    termsAndConditions: { type: 'string', description: 'Terms and conditions.' },
    clientNotes: { type: 'string', description: 'Client-facing notes.' },
    version: { type: 'number', description: 'Quote revision number.' },
    acceptedByName: { type: 'string', description: 'Name of the accepting contact or user.' },
    acceptedAt: { type: 'string', description: 'Acceptance timestamp.' },
  },
  required: ['quoteNumber', 'title', 'total'],
});

const createQuoteTotalsSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    recurringSubtotal: { type: 'number', description: 'Subtotal for recurring line items.' },
    recurringTax: { type: 'number', description: 'Tax for recurring line items.' },
    recurringTotal: { type: 'number', description: 'Total for recurring line items.' },
    onetimeSubtotal: { type: 'number', description: 'Subtotal for one-time line items.' },
    onetimeTax: { type: 'number', description: 'Tax for one-time line items.' },
    onetimeTotal: { type: 'number', description: 'Total for one-time line items.' },
    serviceSubtotal: { type: 'number', description: 'Subtotal for service line items.' },
    serviceTax: { type: 'number', description: 'Tax for service line items.' },
    serviceTotal: { type: 'number', description: 'Total for service line items.' },
    productSubtotal: { type: 'number', description: 'Subtotal for product line items.' },
    productTax: { type: 'number', description: 'Tax for product line items.' },
    productTotal: { type: 'number', description: 'Total for product line items.' },
  },
});

const createQuoteItemSchema = (): SharedExpressionSchemaNode => ({
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Quote line item description.' },
    quantity: { type: 'number', description: 'Quote line item quantity.' },
    unitPrice: { type: 'number', description: 'Quote line item unit price.' },
    total: { type: 'number', description: 'Quote line item total.' },
    billingFrequency: { type: 'string', description: 'Recurring billing frequency.' },
    recurring: { type: 'boolean', description: 'Whether the line item is recurring.' },
    serviceKind: { type: 'string', description: 'Whether the line item is a service or product.' },
  },
});

export const buildInvoiceExpressionContextRoots = (params: {
  documentKind?: 'invoice' | 'quote';
} = {}): SharedExpressionContextRoot[] => {
  if (params.documentKind === 'quote') {
    return [
      {
        key: 'quote',
        label: 'Quote',
        description: 'Quote-level fields',
        schema: createQuoteRootSchema(),
        allowInModes: ['path-only', 'template'],
      },
      {
        key: 'quoteTotals',
        label: 'Quote Totals',
        description: 'Recurring, one-time, service, and product totals.',
        schema: createQuoteTotalsSchema(),
        allowInModes: ['path-only', 'template'],
      },
      {
        key: 'client',
        label: 'Client',
        description: 'Client fields',
        schema: createPartySchema('Client'),
        allowInModes: ['path-only', 'template'],
      },
      {
        key: 'contact',
        label: 'Contact',
        description: 'Contact fields',
        schema: createPartySchema('Contact'),
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
        description: 'Quote line item fields for repeating/table contexts',
        schema: createQuoteItemSchema(),
        allowInModes: ['path-only', 'template'],
      },
    ];
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
  documentKind?: 'invoice' | 'quote';
} = {}): SharedExpressionPathOption[] =>
  buildPathOptionsFromContextRoots(
    buildInvoiceExpressionContextRoots({ documentKind: params.documentKind }),
    params
  );
