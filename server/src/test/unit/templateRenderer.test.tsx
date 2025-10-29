// File: TemplateRenderer.test.tsx

import React from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { render, screen, cleanup } from '@testing-library/react';
import { expect, afterEach } from 'vitest';
import { TemplateRenderer } from 'server/src/components/billing-dashboard/TemplateRenderer';
import { IInvoiceTemplate, InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import { describe, it, test, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Add jest-dom matchers to Vitest
afterEach(() => {
  cleanup();
});

describe('TemplateRenderer', () => {
  test('renders nested field value correctly', () => {
    const template: IInvoiceTemplate = {
      parsed: {
        sections: [
          {
            type: 'header',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'field',
                name: 'client.name',
                position: { column: 1, row: 1 },
                span: { columnSpan: 6, rowSpan: 1 }
              }
            ]
          }
        ], globals: []
      },
      template_id: '',
      name: '',
      version: 0,
      dsl: ''
    };

    const invoiceData: InvoiceViewModel = {
      client: {
        name: 'Acme Corporation',
        logo: '',
        address: ''
      },
      invoice_number: '',
      invoice_date: Temporal.PlainDate.from('2023-01-01'),
      due_date: Temporal.PlainDate.from('2023-01-31'),
      total: 0,
      status: 'draft',
      invoice_charges: [],
      client_id: 'test-client-1',
      total_amount: 0,
      credit_applied: 0,
      is_manual: false,
      contact: {
        name: '',
        address: ''
      },
      subtotal: 0,
      tax: 0,
      invoice_id: ''
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
  });

  test('renders nested non-nested field value correctly', () => {
    const template: IInvoiceTemplate = {
      parsed: {
        sections: [
          {
            type: 'header',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'field',
                name: 'status',
                position: { column: 1, row: 1 },
                span: { columnSpan: 6, rowSpan: 1 }
              }
            ],
          },
          {
            type: 'summary',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'field',
                name: 'subtotal',
                position: { column: 1, row: 1 },
                span: { columnSpan: 6, rowSpan: 1 }
              }
            ]
          }
        ], globals: []
      },
      template_id: '',
      name: '',
      version: 0,
      dsl: ''
    };

    const invoiceData: InvoiceViewModel = {
      client: {
        name: 'Acme Corporation',
        logo: '',
        address: ''
      },
      invoice_number: '',
      invoice_date: Temporal.PlainDate.from('2023-01-01'),
      due_date: Temporal.PlainDate.from('2023-01-31'),
      status: 'draft',
      invoice_charges: [],
      client_id: 'test-client-1',
      total_amount: 0,
      credit_applied: 0,
      is_manual: false,
      contact: {
        name: '',
        address: ''
      },
      subtotal: 101,
      tax: 0,
      total: 0,
      invoice_id: ''
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
  });
});

describe('TemplateRenderer - Calculated Fields', () => {
  test.todo('renders a simple calculation field', () => {
    const template: IInvoiceTemplate = {
      parsed: {
        sections: [
          {
            type: 'summary',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'calculation',
                name: 'total_items',
                expression: { operation: 'count', field: 'invoice_charges' },
                position: { column: 1, row: 1 },
                span: { columnSpan: 6, rowSpan: 1 },
                isGlobal: false,
                listReference: undefined
              }
            ]
          }
        ], globals: []
      },
      template_id: '',
      name: '',
      version: 0,
      dsl: ''
    };

    const invoiceData: InvoiceViewModel = {
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          description: 'Desc 1',
          quantity: 1,
          unit_price: 10,
          rate: 10,
          total_price: 10,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        },
        {
          item_id: 'item-2',
          invoice_id: 'invoice-1',
          description: 'Desc 2',
          quantity: 2,
          unit_price: 20,
          rate: 20,
          total_price: 40,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        }
      ],
      invoice_number: '',
      client: { name: '', logo: '', address: '' },
      contact: { name: '', address: '' },
      invoice_date: Temporal.PlainDate.from('2023-01-01'),
      due_date: Temporal.PlainDate.from('2023-01-31'),
      status: 'draft',
      subtotal: 50,
      tax: 0,
      total: 50,
      invoice_id: '',
      client_id: 'test-client-1',
      total_amount: 50,
      credit_applied: 0,
      is_manual: false
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(screen.getByText((content: string, element: Element | null) => {
      return content.indexOf('2') !== -1;
    })).toBeInTheDocument(); // Count of invoice_charges
  });

  test.todo('renders a sum calculation field', () => {
    const template: IInvoiceTemplate = {
      parsed: {
        sections: [
          {
            type: 'summary',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'calculation',
                name: 'total_price',
                expression: { operation: 'sum', field: 'total_price' },
                position: { column: 1, row: 1 },
                span: { columnSpan: 6, rowSpan: 1 },
                isGlobal: false,
                listReference: 'invoice_charges'
              }
            ]
          }
        ],
        globals: []
      },
      template_id: '',
      name: '',
      version: 0,
      dsl: ''
    };

    const invoiceData: InvoiceViewModel = {
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          description: 'Desc 1',
          quantity: 1,
          unit_price: 10,
          rate: 10,
          total_price: 10,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        },
        {
          item_id: 'item-2',
          invoice_id: 'invoice-1',
          description: 'Desc 2',
          quantity: 2,
          unit_price: 20,
          rate: 20,
          total_price: 40,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        }
      ],
      invoice_number: '',
      client: { name: '', logo: '', address: '' },
      contact: { name: '', address: '' },
      invoice_date: Temporal.PlainDate.from('2023-01-01'),
      due_date: Temporal.PlainDate.from('2023-01-31'),
      status: 'draft',
      subtotal: 50,
      tax: 0,
      total: 50,
      invoice_id: '',
      client_id: 'test-client-1',
      total_amount: 50,
      credit_applied: 0,
      is_manual: false
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(screen.getByText((content: string, element: Element | null) => {
      return content.indexOf('50') !== -1;
    })).toBeInTheDocument(); // Sum of total_price
  });

  test('renders global calculation correctly', () => {
    const template: IInvoiceTemplate = {
      parsed: {
        sections: [
          {
            type: 'summary',
            grid: { columns: 12, minRows: 1 },
            content: [
              {
                type: 'field',
                name: 'global_subtotal',
                position: { column: 10, row: 1 },
                span: { columnSpan: 3, rowSpan: 1 }
              }
            ]
          }
        ],
        globals: [
          {
            type: 'calculation',
            name: 'global_subtotal',
            expression: { operation: 'sum', field: 'invoice_charges' },
            isGlobal: true
          }
        ]
      },
      template_id: '',
      name: '',
      version: 0,
      dsl: ''
    };

    const invoiceData: InvoiceViewModel = {
      client: {
        name: 'Acme Corporation',
        logo: '',
        address: ''
      },
      invoice_number: 'INV-001',
      invoice_date: Temporal.PlainDate.from('2023-05-01'),
      due_date: Temporal.PlainDate.from('2023-05-15'),
      total: 150,
      status: 'draft',
      subtotal: 150,
      tax: 0,
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          description: 'Description 1',
          quantity: 1,
          unit_price: 100,
          rate: 100,
          total_price: 100,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        },
        {
          item_id: 'item-2',
          invoice_id: 'invoice-1',
          description: 'Description 2',
          quantity: 1,
          unit_price: 50,
          rate: 50,
          total_price: 50,
          tax_amount: 0,
          net_amount: 0,
          is_manual: false
        }
      ],
      contact: {
        name: '',
        address: ''
      },
      invoice_id: '',
      client_id: 'test-client-1',
      total_amount: 150,
      credit_applied: 0,
      is_manual: false
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(screen.getByText('150')).toBeInTheDocument(); // The sum of total_price from invoice_charges
  });
});
