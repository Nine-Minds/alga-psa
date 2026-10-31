import type { InvoiceBundleComponentSnapshot, InvoiceBundlePresentation, WasmInvoiceViewModel } from '@alga-psa/types';
import { INVOICE_BUNDLE_PRESENTATION_VERSION } from '@alga-psa/types';
import { buildBundleComponents } from '../../../lib/invoiceBundleComponents/components';
import {
  buildInvoiceTimeCollections,
  attachInvoiceTimeCollections,
  enrichWithGroupedItems,
  type InvoiceTimeCollectionSource,
} from '../../../lib/adapters/invoiceAdapters';

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
  paymentMethod: 'Credit Card',
  customer: {
    name: 'Hawthorne Clinic',
    address: '1150 Oak Street, Portland, OR 97205',
  },
  // Fallback issuer only: overlayInvoiceSampleTenant replaces this with the tenant's real
  // "Your Company" branding whenever it resolves.
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

const enrichScenario = (scenario: InvoicePreviewSampleScenario): InvoicePreviewSampleScenario => {
  const data = enrichWithGroupedItems({ ...scenario.data });
  if (scenario.id === 'sample-ticket-time-detail') {
    attachInvoiceTimeCollections(data, data.items.map((item) => {
      const sources = TICKET_TIME_SAMPLE_SOURCES.filter((s) => s.itemId === item.id);
      return { item_id: item.id, invoice_id: 'sample', tenant: 'sample', net_amount: item.total,
        billing_charge_type: sources.length ? 'time' : 'fixed', time_entry_snapshots: sources,
        time_entry_links: sources.map((s) => ({ itemId: item.id, invoiceId: 'sample', tenant: 'sample', entryId: s.entryId, snapshot: s })),
      };
    }));
  }
  return { ...scenario, data };
};

/**
 * Billed-time snapshot sources for the ticket-detail sample. Run through the
 * same `buildInvoiceTimeCollections` the production read path uses, so the
 * designer preview of `ticketGroups` / `timeEntries` matches generated PDFs
 * (including the explicit mixed-rate representation on the second ticket).
 */
const TICKET_TIME_SAMPLE_SOURCES: InvoiceTimeCollectionSource[] = [
  {
    version: 2,
    rateKind: 'uniform',
    uniformRate: 15000,
    entryId: 'entry-a1',
    itemId: 'time-a1',
    workItemType: 'ticket',
    workItemId: 'ticket-a',
    ticketNumber: 'T-20260118-004',
    title: 'Email outage — Exchange connector down',
    description: 'Investigated failed mail flow and restored the Exchange connector.',
    entryDate: '2026-01-18',
    billedMinutes: 90,
    rate: 15000,
    netAmount: 22500,
    serviceId: 'svc-remote',
    serviceName: 'Remote Support',
  },
  {
    version: 2,
    rateKind: 'uniform',
    uniformRate: 15000,
    entryId: 'entry-a2',
    itemId: 'time-a2',
    workItemType: 'ticket',
    workItemId: 'ticket-a',
    ticketNumber: 'T-20260118-004',
    title: 'Email outage — Exchange connector down',
    description: 'Investigated failed mail flow and restored the Exchange connector.',
    entryDate: '2026-01-19',
    billedMinutes: 60,
    rate: 15000,
    netAmount: 15000,
    serviceId: 'svc-remote',
    serviceName: 'Remote Support',
  },
  {
    version: 2,
    rateKind: 'uniform',
    uniformRate: 12500,
    entryId: 'entry-b1',
    itemId: 'time-b1',
    workItemType: 'ticket',
    workItemId: 'ticket-b',
    ticketNumber: 'T-20260122-011',
    title: 'Onboard new staff workstation',
    description: 'Provisioned and configured a new workstation for incoming staff.',
    entryDate: '2026-01-22',
    billedMinutes: 120,
    rate: 12500,
    netAmount: 25000,
    serviceId: 'svc-onsite',
    serviceName: 'Onsite Support',
  },
  {
    version: 2,
    rateKind: 'uniform',
    uniformRate: 15000,
    entryId: 'entry-b2',
    itemId: 'time-b2',
    workItemType: 'ticket',
    workItemId: 'ticket-b',
    ticketNumber: 'T-20260122-011',
    title: 'Onboard new staff workstation',
    description: 'Provisioned and configured a new workstation for incoming staff.',
    entryDate: '2026-01-23',
    billedMinutes: 30,
    rate: 15000,
    netAmount: 7500,
    serviceId: 'svc-afterhours',
    serviceName: 'After Hours Support',
  },
  {
    version: 2,
    rateKind: 'uniform',
    uniformRate: 14000,
    entryId: 'entry-p1',
    itemId: 'time-p1',
    workItemType: 'project_task',
    workItemId: 'task-migration-sync',
    ticketNumber: null,
    title: 'Server migration — data sync validation',
    description: null,
    entryDate: '2026-01-25',
    billedMinutes: 120,
    rate: 14000,
    netAmount: 28000,
    serviceId: 'svc-professional',
    serviceName: 'Professional Services',
  },
];

const TICKET_TIME_SAMPLE_COLLECTIONS = buildInvoiceTimeCollections(TICKET_TIME_SAMPLE_SOURCES);

/**
 * A Fixed-bundle sample item built through the production snapshot->component mapper
 * (`buildBundleComponents`), so the designer preview cannot drift from generated invoices.
 * Priced rows are included because the designer is MSP-only.
 */
const bundleSampleItem = (
  id: string,
  title: string,
  subtitle: string | null,
  total: number,
  components: Array<Omit<InvoiceBundleComponentSnapshot, 'order' | 'detailItemIds' | 'servicePeriodStart' | 'servicePeriodEnd'> & { amount: number; rate?: number }>,
) => {
  const amounts: Record<string, { allocated_amount: number; rate: number }> = {};
  const snapshot: InvoiceBundlePresentation = {
    version: INVOICE_BUNDLE_PRESENTATION_VERSION,
    subtitle,
    components: components.map(({ amount, rate, ...component }, index) => {
      const detailId = `${id}-detail-${index}`;
      amounts[detailId] = { allocated_amount: amount, rate: rate ?? 0 };
      return { ...component, order: index, detailItemIds: [detailId], servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01' };
    }),
  };
  const built = buildBundleComponents(snapshot, { includePricing: true, amounts });
  return {
    id,
    description: title,
    quantity: 1,
    unitPrice: total,
    total,
    subtitle: built?.subtitle ?? null,
    hasComponents: built?.hasComponents ?? false,
    components: built?.components ?? [],
  };
};

export const INVOICE_PREVIEW_SAMPLE_SCENARIOS: InvoicePreviewSampleScenario[] = [
  enrichScenario({
    id: 'sample-simple-services',
    label: 'Simple Services',
    description: 'Small services invoice with straightforward labor and monitoring items.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0147',
      issueDate: '2026-02-06',
      dueDate: '2026-02-20',
      recurringServicePeriodStart: '2026-01-01',
      recurringServicePeriodEnd: '2026-03-01',
      recurringServicePeriodLabel: 'Jan 1, 2026 - Mar 1, 2026',
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
          taxAmount: 5670,
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-02-01',
          billingTiming: 'arrears',
          recurringDetailPeriods: [
            {
              servicePeriodStart: '2026-01-01',
              servicePeriodEnd: '2026-02-01',
              billingTiming: 'arrears',
            },
          ],
        },
        {
          id: 'svc-patching',
          description: 'Patch Management',
          quantity: 15,
          unitPrice: 1600,
          total: 24000,
          taxAmount: 2160,
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-03-01',
          billingTiming: 'arrears',
          recurringDetailPeriods: [
            {
              servicePeriodStart: '2026-01-01',
              servicePeriodEnd: '2026-02-01',
              billingTiming: 'arrears',
            },
            {
              servicePeriodStart: '2026-02-01',
              servicePeriodEnd: '2026-03-01',
              billingTiming: 'arrears',
            },
          ],
        },
      ],
      subtotal: 87000,
      tax: 7830,
      total: 94830,
    },
  }),
  enrichScenario({
    id: 'sample-mixed-recurring',
    label: 'Mixed Recurring + One-time',
    description: 'Invoice with both recurring services and one-time project charges.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0192',
      issueDate: '2026-02-03',
      dueDate: '2026-02-17',
      recurringServicePeriodStart: '2026-01-01',
      recurringServicePeriodEnd: '2026-03-01',
      recurringServicePeriodLabel: 'Jan 1, 2026 - Mar 1, 2026',
      poNumber: 'PO-8831',
      paymentMethod: 'Check',
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
          taxAmount: 8700,
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-03-01',
          billingTiming: 'advance',
          recurringDetailPeriods: [
            { servicePeriodStart: '2026-02-01', servicePeriodEnd: '2026-03-01', billingTiming: 'advance' },
          ],
        },
        {
          id: 'svc-monitoring',
          description: 'Managed Endpoint Monitoring',
          quantity: 12,
          unitPrice: 4200,
          total: 50400,
          taxAmount: 3024,
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-02-01',
          billingTiming: 'arrears',
          recurringDetailPeriods: [
            { servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears' },
          ],
        },
        {
          id: 'svc-onsite',
          description: 'On-site Remediation (4 hours)',
          quantity: 4,
          unitPrice: 12500,
          total: 50000,
          taxAmount: 3000,
        },
        {
          id: 'svc-migration',
          description: 'Server Migration',
          quantity: 1,
          unitPrice: 350000,
          total: 350000,
          taxAmount: 21000,
        },
        {
          id: 'svc-discount',
          description: 'Loyalty Discount',
          quantity: 1,
          unitPrice: -15000,
          total: -15000,
          taxAmount: 0,
        },
      ],
      subtotal: 580400,
      tax: 35724,
      total: 616124,
    },
  }),
  enrichScenario({
    id: 'sample-discount-credit',
    label: 'Discount + Credit',
    description: 'Invoice with discount and credit-style adjustments.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0205',
      issueDate: '2026-02-05',
      dueDate: '2026-02-19',
      recurringServicePeriodStart: '2026-02-01',
      recurringServicePeriodEnd: '2026-03-01',
      recurringServicePeriodLabel: 'Feb 1, 2026 - Mar 1, 2026',
      poNumber: 'PO-9942',
      paymentMethod: 'Bank Transfer',
      customer: {
        name: 'Summit Physical Therapy',
        address: '320 Mountain View Dr, Boulder, CO 80302',
      },
      items: [
        {
          id: 'svc-helpdesk',
          description: 'Help Desk Retainer',
          quantity: 1,
          unitPrice: 145000,
          total: 145000,
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-03-01',
          billingTiming: 'advance',
          recurringDetailPeriods: [
            { servicePeriodStart: '2026-02-01', servicePeriodEnd: '2026-03-01', billingTiming: 'advance' },
          ],
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
  }),
  enrichScenario({
    id: 'sample-ticket-time-detail',
    label: 'Ticket Time Detail',
    description: 'Ticket-backed billed time with per-ticket grouping, a mixed-rate ticket, and project-task time.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0233',
      issueDate: '2026-02-02',
      dueDate: '2026-02-16',
      poNumber: 'PO-5120',
      customer: {
        name: 'EQUIT Manufacturing',
        address: '48 Foundry Road, Sydney NSW 2000',
      },
      items: [
        {
          id: 'svc-monitoring',
          description: 'Managed Endpoint Monitoring',
          quantity: 15,
          unitPrice: 4200,
          total: 63000,
          taxAmount: 5670,
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-02-01',
          billingTiming: 'arrears',
          recurringDetailPeriods: [
            { servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears' },
          ],
        },
        { id: 'time-a1', description: 'Remote Support', quantity: 1.5, unitPrice: 15000, total: 22500, taxAmount: 0 },
        { id: 'time-a2', description: 'Remote Support', quantity: 1, unitPrice: 15000, total: 15000, taxAmount: 0 },
        { id: 'time-b1', description: 'Onsite Support', quantity: 2, unitPrice: 12500, total: 25000, taxAmount: 0 },
        { id: 'time-b2', description: 'After Hours Support', quantity: 0.5, unitPrice: 15000, total: 7500, taxAmount: 0 },
        { id: 'time-p1', description: 'Professional Services', quantity: 2, unitPrice: 14000, total: 28000, taxAmount: 0 },
      ],
      subtotal: 161000,
      tax: 5670,
      total: 166670,
      timeEntries: TICKET_TIME_SAMPLE_COLLECTIONS.timeEntries,
      ticketGroups: TICKET_TIME_SAMPLE_COLLECTIONS.ticketGroups,
    },
  }),
  enrichScenario({
    id: 'sample-high-line-count',
    label: 'High Line Count',
    description: 'Large invoice to validate dense tables and totals rendering.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0227',
      issueDate: '2026-02-08',
      dueDate: '2026-02-28',
      recurringServicePeriodStart: '2026-01-01',
      recurringServicePeriodEnd: '2026-02-01',
      recurringServicePeriodLabel: 'Jan 1, 2026 - Feb 1, 2026',
      poNumber: null,
      paymentMethod: null,
      customer: {
        name: 'Helios Logistics Group',
        address: '2600 Meridian Blvd, Austin, TX 78741',
      },
      items: [
        { id: 'line-1', description: 'Managed User Seat - Dept A', quantity: 18, unitPrice: 9500, total: 171000, billingTiming: 'arrears' as const, recurringDetailPeriods: [{ servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears' as const }] },
        { id: 'line-2', description: 'Managed User Seat - Dept B', quantity: 22, unitPrice: 9500, total: 209000, billingTiming: 'arrears' as const, recurringDetailPeriods: [{ servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears' as const }] },
        { id: 'line-3', description: 'Managed User Seat - Dept C', quantity: 27, unitPrice: 9500, total: 256500, billingTiming: 'arrears' as const, recurringDetailPeriods: [{ servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears' as const }] },
        { id: 'line-4', description: 'Security Awareness Training', quantity: 67, unitPrice: 600, total: 40200 },
        { id: 'line-5', description: 'Endpoint Backup Add-on', quantity: 67, unitPrice: 1200, total: 80400 },
        { id: 'line-6', description: 'SOC Alert Triage', quantity: 14, unitPrice: 7800, total: 109200 },
        { id: 'line-7', description: 'After Hours Support', quantity: 6, unitPrice: 18000, total: 108000 },
      ],
      subtotal: 974300,
      tax: 77944,
      total: 1052244,
    },
  }),
  enrichScenario({
    id: 'sample-managed-services-bundles',
    label: 'Managed services bundles',
    description: 'Fixed bundles with component rows: seat counts, +/- change vs last period, and a mixed seat/allocated bundle.',
    data: {
      ...createBaseInvoice(),
      invoiceNumber: 'INV-2026-0301',
      issueDate: '2026-02-03',
      dueDate: '2026-02-17',
      recurringServicePeriodStart: '2026-01-01',
      recurringServicePeriodEnd: '2026-02-01',
      recurringServicePeriodLabel: 'Jan 1, 2026 - Feb 1, 2026',
      items: [
        bundleSampleItem('bundle-managed-it', 'Managed IT Services', 'Per-seat monitoring, backup and security', 412500, [
          { serviceId: 'svc-seats', name: 'Managed User Seat', quantity: 25, pricingBasis: 'unit', previousQuantity: 22, comparison: 'compared', amount: 237500, rate: 9500 },
          { serviceId: 'svc-edr', name: 'Endpoint Protection', quantity: 25, pricingBasis: 'unit', previousQuantity: 25, comparison: 'compared', amount: 75000, rate: 3000 },
          { serviceId: 'svc-backup', name: 'Cloud Backup', quantity: 3, pricingBasis: 'unit', previousQuantity: 4, comparison: 'compared', amount: 60000, rate: 20000 },
          { serviceId: 'svc-vciso', name: 'vCISO Advisory', quantity: null, pricingBasis: 'bundle', previousQuantity: null, comparison: 'no_prior_period', amount: 40000 },
        ]),
        bundleSampleItem('bundle-voip', 'Hosted Voice', null, 90000, [
          { serviceId: 'svc-voip-seat', name: 'Voice Seat', quantity: 12, pricingBasis: 'unit', previousQuantity: null, comparison: 'no_prior_period', amount: 72000, rate: 6000 },
          { serviceId: 'svc-voip-trunk', name: 'SIP Trunk (allocated)', quantity: 1, pricingBasis: 'bundle', previousQuantity: null, comparison: 'no_prior_period', amount: 18000 },
        ]),
        { id: 'adhoc-1', description: 'After Hours Support', quantity: 2, unitPrice: 18000, total: 36000 },
      ],
      subtotal: 538500,
      tax: 43080,
      total: 581580,
    },
  }),
];

export const DEFAULT_PREVIEW_SAMPLE_ID = INVOICE_PREVIEW_SAMPLE_SCENARIOS[0]?.id ?? null;

export const getPreviewSampleScenarioById = (scenarioId: string | null) =>
  INVOICE_PREVIEW_SAMPLE_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null;
