import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

const cloneAst = (ast: InvoiceTemplateAst): InvoiceTemplateAst =>
  JSON.parse(JSON.stringify(ast)) as InvoiceTemplateAst;

const buildSharedBindings = (): NonNullable<InvoiceTemplateAst['bindings']> => ({
  values: {
    invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
    poNumber: { id: 'poNumber', kind: 'value', path: 'poNumber' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total' },
    tenantClientName: {
      id: 'tenantClientName',
      kind: 'value',
      path: 'tenantClient.name',
      fallback: 'Your Company',
    },
    tenantClientAddress: {
      id: 'tenantClientAddress',
      kind: 'value',
      path: 'tenantClient.address',
      fallback: 'Company address',
    },
    tenantClientLogo: {
      id: 'tenantClientLogo',
      kind: 'value',
      path: 'tenantClient.logoUrl',
    },
    customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
    customerAddress: {
      id: 'customerAddress',
      kind: 'value',
      path: 'customer.address',
      fallback: 'Customer address',
    },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
  },
});

const buildStandardDefaultAst = (templateName: string): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  metadata: {
    templateName,
  },
  bindings: buildSharedBindings(),
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

const buildStandardDetailedAst = (): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  metadata: {
    templateName: 'Detailed Template',
  },
  bindings: buildSharedBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: {
          inline: {
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '24px',
            margin: '0 0 20px 0',
          },
        },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '6px',
              },
            },
            children: [
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantClientLogo' },
                alt: {
                  type: 'template',
                  template: '{{name}} logo',
                  args: {
                    name: { type: 'binding', bindingId: 'tenantClientName' },
                  },
                },
                style: {
                  inline: {
                    width: '180px',
                    maxHeight: '72px',
                    margin: '0 0 6px 0',
                  },
                },
              },
              {
                id: 'issuer-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientName' },
                style: {
                  inline: {
                    fontSize: '18px',
                    fontWeight: 700,
                    lineHeight: 1.2,
                  },
                },
              },
              {
                id: 'issuer-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientAddress' },
                style: {
                  inline: {
                    color: '#4b5563',
                    lineHeight: 1.4,
                  },
                },
              },
            ],
          },
          {
            id: 'invoice-meta-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                minWidth: '280px',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '14px 16px',
                backgroundColor: '#f9fafb',
                gap: '6px',
              },
            },
            children: [
              {
                id: 'invoice-title',
                type: 'text',
                content: { type: 'literal', value: 'INVOICE' },
                style: {
                  inline: {
                    fontSize: '22px',
                    fontWeight: 700,
                    margin: '0 0 4px 0',
                    lineHeight: 1.1,
                  },
                },
              },
              {
                id: 'invoice-number',
                type: 'field',
                label: 'Invoice #',
                binding: { bindingId: 'invoiceNumber' },
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'issue-date',
                type: 'field',
                label: 'Issue Date',
                binding: { bindingId: 'issueDate' },
                format: 'date',
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'due-date',
                type: 'field',
                label: 'Due Date',
                binding: { bindingId: 'dueDate' },
                format: 'date',
                style: { inline: { justifyContent: 'space-between' } },
              },
              {
                id: 'po-number',
                type: 'field',
                label: 'PO #',
                binding: { bindingId: 'poNumber' },
                emptyValue: '-',
                style: { inline: { justifyContent: 'space-between' } },
              },
            ],
          },
        ],
      },
      {
        id: 'header-divider',
        type: 'divider',
        style: {
          inline: {
            margin: '0 0 20px 0',
          },
        },
      },
      {
        id: 'party-blocks',
        type: 'stack',
        direction: 'row',
        style: {
          inline: {
            gap: '24px',
            margin: '0 0 20px 0',
          },
        },
        children: [
          {
            id: 'from-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '4px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px 14px',
              },
            },
            children: [
              {
                id: 'from-label',
                type: 'text',
                content: { type: 'literal', value: 'From' },
                style: {
                  inline: {
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 700,
                    margin: '0 0 2px 0',
                  },
                },
              },
              {
                id: 'from-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientName' },
                style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } },
              },
              {
                id: 'from-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantClientAddress' },
                style: { inline: { color: '#4b5563', lineHeight: 1.4 } },
              },
            ],
          },
          {
            id: 'bill-to-card',
            type: 'stack',
            direction: 'column',
            style: {
              inline: {
                gap: '4px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px 14px',
              },
            },
            children: [
              {
                id: 'bill-to-label',
                type: 'text',
                content: { type: 'literal', value: 'Bill To' },
                style: {
                  inline: {
                    color: '#6b7280',
                    fontSize: '12px',
                    fontWeight: 700,
                    margin: '0 0 2px 0',
                  },
                },
              },
              {
                id: 'bill-to-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'customerName' },
                style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } },
              },
              {
                id: 'bill-to-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'customerAddress' },
                style: { inline: { color: '#4b5563', lineHeight: 1.4 } },
              },
            ],
          },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: {
          inline: {
            margin: '0 0 16px 0',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
          },
        },
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        emptyStateText: 'No billable line items',
        columns: [
          {
            id: 'description',
            header: 'Description',
            value: { type: 'path', path: 'description' },
            style: { inline: { width: '50%' } },
          },
          {
            id: 'quantity',
            header: 'Qty',
            value: { type: 'path', path: 'quantity' },
            format: 'number',
            style: { inline: { textAlign: 'right', width: '14%' } },
          },
          {
            id: 'unit-price',
            header: 'Rate',
            value: { type: 'path', path: 'unitPrice' },
            format: 'currency',
            style: { inline: { textAlign: 'right', width: '18%' } },
          },
          {
            id: 'line-total',
            header: 'Amount',
            value: { type: 'path', path: 'total' },
            format: 'currency',
            style: { inline: { textAlign: 'right', width: '18%' } },
          },
        ],
      },
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: {
              inline: {
                width: '300px',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '10px 12px',
                backgroundColor: '#f9fafb',
              },
            },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              {
                id: 'subtotal',
                label: 'Subtotal',
                value: { type: 'binding', bindingId: 'subtotal' },
                format: 'currency',
              },
              {
                id: 'tax',
                label: 'Tax',
                value: { type: 'binding', bindingId: 'tax' },
                format: 'currency',
              },
              {
                id: 'total',
                label: 'Total',
                value: { type: 'binding', bindingId: 'total' },
                format: 'currency',
                emphasize: true,
              },
            ],
          },
        ],
      },
    ],
  },
});

export const STANDARD_INVOICE_TEMPLATE_ASTS: Readonly<Record<string, InvoiceTemplateAst>> = {
  'standard-default': buildStandardDefaultAst('Standard Template'),
  'standard-detailed': buildStandardDetailedAst(),
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
