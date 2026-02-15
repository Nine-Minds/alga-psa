import type { WasmInvoiceViewModel } from '@alga-psa/types';

export type InvoicePreviewSampleScenario = {
  id: string;
  label: string;
  description: string;
  data: WasmInvoiceViewModel;
};

const createBaseInvoice = (): WasmInvoiceViewModel => ({
  invoiceNumber: 'INV-2026-0001',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: 'PO-4412',
  customer: {
    name: 'Hawthorne Clinic',
    address: '1150 Oak Street, Portland, OR 97205',
  },
  tenantClient: {
    name: 'Northwind MSP',
    address: '400 SW Main St, Portland, OR 97204',
    logoUrl: null,
  },
  items: [],
  subtotal: 0,
  tax: 0,
  total: 0,
  taxSource: 'internal',
});

export const INVOICE_PREVIEW_SAMPLE_SCENARIOS: InvoicePreviewSampleScenario[] = [
  {
    id: 'sample-simple-services',
    label: 'Simple Services',
    description: 'Small services invoice with straightforward labor and monitoring items.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0147',
      issueDate: '2026-02-06',
      dueDate: '2026-02-20',
      customer: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave, Seattle, WA 98104',
      },
      items: [
        {
          id: 'svc-monitoring',
          description: 'Managed Endpoint Monitoring',
          quantity: 15,
          unitPrice: 4200,
          total: 63000,
        },
        {
          id: 'svc-patching',
          description: 'Patch Management',
          quantity: 15,
          unitPrice: 1600,
          total: 24000,
        },
      ],
      subtotal: 87000,
      tax: 7830,
      total: 94830,
    },
  },
  {
    id: 'sample-discount-credit',
    label: 'Discount + Credit',
    description: 'Invoice with discount and credit-style adjustments.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0192',
      issueDate: '2026-02-03',
      dueDate: '2026-02-17',
      poNumber: 'PO-8831',
      customer: {
        name: 'Evergreen Animal Hospital',
        address: '77 Fremont St, Denver, CO 80203',
      },
      items: [
        {
          id: 'svc-helpdesk',
          description: 'Help Desk Retainer',
          quantity: 1,
          unitPrice: 145000,
          total: 145000,
        },
        {
          id: 'svc-onsite',
          description: 'On-site Remediation (4 hours)',
          quantity: 4,
          unitPrice: 12500,
          total: 50000,
        },
        {
          id: 'svc-discount',
          description: 'Loyalty Discount',
          quantity: 1,
          unitPrice: -15000,
          total: -15000,
        },
      ],
      subtotal: 180000,
      tax: 10800,
      total: 190800,
    },
  },
  {
    id: 'sample-high-line-count',
    label: 'High Line Count',
    description: 'Large invoice to validate dense tables and totals rendering.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0227',
      issueDate: '2026-02-08',
      dueDate: '2026-02-28',
      poNumber: null,
      customer: {
        name: 'Helios Logistics Group',
        address: '2600 Meridian Blvd, Austin, TX 78741',
      },
      items: [
        { id: 'line-1', description: 'Managed User Seat - Dept A', quantity: 18, unitPrice: 9500, total: 171000 },
        { id: 'line-2', description: 'Managed User Seat - Dept B', quantity: 22, unitPrice: 9500, total: 209000 },
        { id: 'line-3', description: 'Managed User Seat - Dept C', quantity: 27, unitPrice: 9500, total: 256500 },
        { id: 'line-4', description: 'Security Awareness Training', quantity: 67, unitPrice: 600, total: 40200 },
        { id: 'line-5', description: 'Endpoint Backup Add-on', quantity: 67, unitPrice: 1200, total: 80400 },
        { id: 'line-6', description: 'SOC Alert Triage', quantity: 14, unitPrice: 7800, total: 109200 },
        { id: 'line-7', description: 'After Hours Support', quantity: 6, unitPrice: 18000, total: 108000 },
      ],
      subtotal: 974300,
      tax: 77944,
      total: 1052244,
    },
  },
];

export const DEFAULT_PREVIEW_SAMPLE_ID = INVOICE_PREVIEW_SAMPLE_SCENARIOS[0]?.id ?? null;

export const getPreviewSampleScenarioById = (scenarioId: string | null) =>
  INVOICE_PREVIEW_SAMPLE_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null;
