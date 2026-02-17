import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

const cloneAst = (ast: InvoiceTemplateAst): InvoiceTemplateAst =>
  JSON.parse(JSON.stringify(ast)) as InvoiceTemplateAst;

const buildBaseStandardAst = (templateName: string): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  metadata: {
    templateName,
  },
  bindings: {
    values: {
      invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
      issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
      dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
      subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
      tax: { id: 'tax', kind: 'value', path: 'tax' },
      total: { id: 'total', kind: 'value', path: 'total' },
    },
    collections: {
      lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
    },
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'section',
        title: 'Invoice',
        children: [
          {
            id: 'invoice-number',
            type: 'field',
            label: 'Invoice #',
            binding: { bindingId: 'invoiceNumber' },
          },
          {
            id: 'issue-date',
            type: 'field',
            label: 'Issue Date',
            binding: { bindingId: 'issueDate' },
            format: 'date',
          },
          {
            id: 'due-date',
            type: 'field',
            label: 'Due Date',
            binding: { bindingId: 'dueDate' },
            format: 'date',
          },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        columns: [
          {
            id: 'description',
            header: 'Description',
            value: { type: 'path', path: 'description' },
          },
          {
            id: 'quantity',
            header: 'Qty',
            value: { type: 'path', path: 'quantity' },
            format: 'number',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'unit-price',
            header: 'Rate',
            value: { type: 'path', path: 'unitPrice' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'line-total',
            header: 'Amount',
            value: { type: 'path', path: 'total' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ],
      },
    ],
  },
});

export const STANDARD_INVOICE_TEMPLATE_ASTS: Readonly<Record<string, InvoiceTemplateAst>> = {
  'standard-default': buildBaseStandardAst('Standard Template'),
  'standard-detailed': buildBaseStandardAst('Detailed Template'),
};

export const getStandardInvoiceTemplateAstByCode = (
  code: string | null | undefined
): InvoiceTemplateAst | undefined => {
  if (!code) {
    return undefined;
  }
  const ast = STANDARD_INVOICE_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : undefined;
};
