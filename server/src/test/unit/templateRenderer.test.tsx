// File: TemplateRenderer.test.tsx

/* @vitest-environment jsdom */
import React from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { render, screen, cleanup } from '@testing-library/react';
import { expect, afterEach } from 'vitest';
import { TemplateRenderer } from '@alga-psa/billing';
import type { IInvoiceTemplate, WasmInvoiceViewModel } from '@alga-psa/types';
import { describe, it, test, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const renderTemplateOnServerMock = vi.fn(async (_templateId: string, data: WasmInvoiceViewModel) => {
  const textParts = [
    data.customer?.name,
    data.status,
    String(data.subtotal ?? ''),
    String(data.total ?? ''),
    String(data.items?.length ?? 0),
  ].filter((value) => value && value !== '0');
  return {
    html: `<div>${textParts.join(' ')}</div>`,
    css: '',
  };
});

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  renderTemplateOnServer: (...args: any[]) => renderTemplateOnServerMock(...args),
}));

// Add jest-dom matchers to Vitest
afterEach(() => {
  cleanup();
});

describe('TemplateRenderer', () => {
  test('renders nested field value correctly', async () => {
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

    const invoiceData: WasmInvoiceViewModel = {
      customer: {
        name: 'Acme Corporation',
        address: ''
      },
      items: [],
      invoice_number: '',
      status: 'draft',
      subtotal: 0,
      tax: 0,
      total: 0,
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(await screen.findByText(/Acme Corporation/)).toBeInTheDocument();
  });

  test('renders nested non-nested field value correctly', async () => {
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

    const invoiceData: WasmInvoiceViewModel = {
      customer: {
        name: 'Acme Corporation',
        address: ''
      },
      items: [],
      invoice_number: '',
      status: 'draft',
      subtotal: 101,
      tax: 0,
      total: 0,
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);
    expect(await screen.findByText(/draft/)).toBeInTheDocument();
    expect(await screen.findByText(/101/)).toBeInTheDocument();
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

    const invoiceData: WasmInvoiceViewModel = {
      items: [
        {
          id: 'item-1',
          description: 'Desc 1',
          quantity: 1,
          unitPrice: 10,
          total: 10,
        },
        {
          id: 'item-2',
          description: 'Desc 2',
          quantity: 2,
          unitPrice: 20,
          total: 40,
        }
      ],
      invoice_number: '',
      customer: { name: '', address: '' },
      status: 'draft',
      subtotal: 50,
      tax: 0,
      total: 50,
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

    const invoiceData: WasmInvoiceViewModel = {
      items: [
        {
          id: 'item-1',
          description: 'Desc 1',
          quantity: 1,
          unitPrice: 10,
          total: 10,
        },
        {
          id: 'item-2',
          description: 'Desc 2',
          quantity: 2,
          unitPrice: 20,
          total: 40,
        }
      ],
      invoice_number: '',
      customer: { name: '', address: '' },
      status: 'draft',
      subtotal: 50,
      tax: 0,
      total: 50,
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(screen.getByText((content: string, element: Element | null) => {
      return content.indexOf('50') !== -1;
    })).toBeInTheDocument(); // Sum of total_price
  });

  test('renders global calculation correctly', async () => {
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

    const invoiceData: WasmInvoiceViewModel = {
      customer: {
        name: 'Acme Corporation',
        address: ''
      },
      invoice_number: 'INV-001',
      total: 150,
      status: 'draft',
      subtotal: 150,
      tax: 0,
      items: [
        {
          id: 'item-1',
          description: 'Description 1',
          quantity: 1,
          unitPrice: 100,
          total: 100,
        },
        {
          id: 'item-2',
          description: 'Description 2',
          quantity: 1,
          unitPrice: 50,
          total: 50,
        }
      ],
    };

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    expect(await screen.findByText(/150/)).toBeInTheDocument(); // The sum of total_price from invoice_charges
  });
});
