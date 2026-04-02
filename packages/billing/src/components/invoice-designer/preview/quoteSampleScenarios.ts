import type { QuoteViewModel, QuoteViewModelLineItem } from '@alga-psa/types';

export type QuotePreviewSampleScenario = {
  id: string;
  label: string;
  description: string;
  data: QuoteViewModel;
};

/** Derives recurring/one-time grouped fields from line_items so sample data works with grouped templates. */
function enrichQuoteSampleWithGroups(data: QuoteViewModel): QuoteViewModel {
  const recurring = data.line_items.filter((item: QuoteViewModelLineItem) => item.is_recurring);
  const onetime = data.line_items.filter((item: QuoteViewModelLineItem) => !item.is_recurring);
  const sumField = (items: QuoteViewModelLineItem[], field: 'total_price' | 'tax_amount') =>
    items.reduce((sum, item) => sum + (item[field] ?? 0), 0);

  data.recurring_items = recurring;
  data.onetime_items = onetime;
  data.recurring_subtotal = sumField(recurring, 'total_price');
  data.recurring_tax = sumField(recurring, 'tax_amount');
  data.recurring_total = (data.recurring_subtotal ?? 0) + (data.recurring_tax ?? 0);
  data.onetime_subtotal = sumField(onetime, 'total_price');
  data.onetime_tax = sumField(onetime, 'tax_amount');
  data.onetime_total = (data.onetime_subtotal ?? 0) + (data.onetime_tax ?? 0);

  return data;
}

const createBaseQuote = (): QuoteViewModel => ({
  quote_id: 'preview-quote-001',
  quote_number: 'QT-2026-0001',
  title: 'Managed Services Proposal',
  description: 'Comprehensive managed services proposal for network and endpoint management.',
  scope_of_work: 'Full-scope network monitoring, endpoint management, and help desk services.',
  quote_date: '2026-03-01',
  valid_until: '2026-03-31',
  status: 'sent',
  version: 1,
  po_number: null,
  currency_code: 'USD',
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  terms_and_conditions: 'Net 30. This quote is valid for 30 days from the date of issue.',
  client_notes: null,
  client: {
    name: 'Hawthorne Clinic',
    address: '1150 Oak Street, Portland, OR 97205',
  },
  contact: {
    name: 'Dr. Sarah Chen',
    email: 'sarah.chen@hawthorneclinic.com',
  },
  tenant: {
    name: 'Northwind MSP',
    address: '400 SW Main St, Portland, OR 97204',
  },
  line_items: [],
  phases: [],
});

const enrichQuoteScenario = (scenario: QuotePreviewSampleScenario): QuotePreviewSampleScenario => ({
  ...scenario,
  data: enrichQuoteSampleWithGroups({ ...scenario.data }),
});

export const QUOTE_PREVIEW_SAMPLE_SCENARIOS: QuotePreviewSampleScenario[] = [
  enrichQuoteScenario({
    id: 'sample-simple-quote',
    label: 'Simple Quote',
    description: 'Small services quote with straightforward recurring items.',
    data: {
      ...createBaseQuote(),
      quote_number: 'QT-2026-0042',
      title: 'Monthly Monitoring Package',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave, Seattle, WA 98104',
      },
      contact: {
        name: 'James Park',
        email: 'james@blueharbordental.com',
      },
      line_items: [
        {
          quote_item_id: 'qi-1',
          description: 'Managed Endpoint Monitoring',
          quantity: 15,
          unit_price: 4200,
          total_price: 63000,
          tax_amount: 5670,
          net_amount: 68670,
          is_optional: false,
          is_selected: true,
          is_recurring: true,
          billing_frequency: 'monthly',
          billing_method: 'usage',
        },
        {
          quote_item_id: 'qi-2',
          description: 'Patch Management',
          quantity: 15,
          unit_price: 1600,
          total_price: 24000,
          tax_amount: 2160,
          net_amount: 26160,
          is_optional: false,
          is_selected: true,
          is_recurring: true,
          billing_frequency: 'monthly',
          billing_method: 'usage',
        },
      ],
      subtotal: 87000,
      tax: 7830,
      total_amount: 94830,
    },
  }),
  enrichQuoteScenario({
    id: 'sample-phased-quote',
    label: 'Phased Project',
    description: 'Multi-phase project quote with optional add-ons and discounts.',
    data: {
      ...createBaseQuote(),
      quote_number: 'QT-2026-0089',
      title: 'Infrastructure Modernization',
      description: 'Complete infrastructure refresh including cloud migration and security hardening.',
      client: {
        name: 'Evergreen Animal Hospital',
        address: '77 Fremont St, Denver, CO 80203',
      },
      contact: {
        name: 'Dr. Maria Torres',
        email: 'mtorres@evergreenanimal.com',
      },
      line_items: [
        {
          quote_item_id: 'qi-p1-1',
          description: 'Network Assessment & Planning',
          quantity: 1,
          unit_price: 350000,
          total_price: 350000,
          tax_amount: 0,
          net_amount: 350000,
          phase: 'Discovery',
          is_optional: false,
          is_selected: true,
          is_recurring: false,
          billing_method: 'fixed',
        },
        {
          quote_item_id: 'qi-p2-1',
          description: 'Server Migration (5 servers)',
          quantity: 5,
          unit_price: 120000,
          total_price: 600000,
          tax_amount: 0,
          net_amount: 600000,
          phase: 'Migration',
          is_optional: false,
          is_selected: true,
          is_recurring: false,
          billing_method: 'fixed',
        },
        {
          quote_item_id: 'qi-p2-2',
          description: 'Cloud Backup Configuration',
          quantity: 1,
          unit_price: 85000,
          total_price: 85000,
          tax_amount: 0,
          net_amount: 85000,
          phase: 'Migration',
          is_optional: true,
          is_selected: true,
          is_recurring: false,
          billing_method: 'fixed',
        },
        {
          quote_item_id: 'qi-p3-1',
          description: 'Managed Firewall Service',
          quantity: 1,
          unit_price: 25000,
          total_price: 25000,
          tax_amount: 0,
          net_amount: 25000,
          phase: 'Ongoing',
          is_optional: false,
          is_selected: true,
          is_recurring: true,
          billing_frequency: 'monthly',
          billing_method: 'fixed',
        },
        {
          quote_item_id: 'qi-p3-2',
          description: 'Security Awareness Training',
          quantity: 25,
          unit_price: 600,
          total_price: 15000,
          tax_amount: 0,
          net_amount: 15000,
          phase: 'Ongoing',
          is_optional: true,
          is_selected: false,
          is_recurring: true,
          billing_frequency: 'quarterly',
          billing_method: 'usage',
        },
        {
          quote_item_id: 'qi-d1',
          description: 'Multi-year Commitment Discount (10%)',
          quantity: 1,
          unit_price: -107500,
          total_price: -107500,
          tax_amount: 0,
          net_amount: -107500,
          is_optional: false,
          is_selected: true,
          is_recurring: false,
          is_discount: true,
          discount_type: 'percentage',
          discount_percentage: 10,
        },
      ],
      phases: [
        {
          name: 'Discovery',
          items: [],
        },
        {
          name: 'Migration',
          items: [],
        },
        {
          name: 'Ongoing',
          items: [],
        },
      ],
      subtotal: 1075000,
      discount_total: 107500,
      tax: 0,
      total_amount: 967500,
      terms_and_conditions: 'Net 30. Phase payments due at the start of each phase. Recurring services billed monthly in arrears.',
    },
  }),
  enrichQuoteScenario({
    id: 'sample-large-quote',
    label: 'Large Enterprise',
    description: 'High line count quote for enterprise deployment.',
    data: {
      ...createBaseQuote(),
      quote_number: 'QT-2026-0127',
      title: 'Enterprise Managed Services Agreement',
      client: {
        name: 'Helios Logistics Group',
        address: '2600 Meridian Blvd, Austin, TX 78741',
      },
      contact: {
        name: 'Robert Schneider',
        email: 'r.schneider@helioslogistics.com',
      },
      po_number: 'PO-ENT-2026-441',
      line_items: [
        { quote_item_id: 'ql-1', description: 'Managed User Seat - HQ', quantity: 45, unit_price: 9500, total_price: 427500, tax_amount: 34200, net_amount: 461700, is_optional: false, is_selected: true, is_recurring: true, billing_frequency: 'monthly', billing_method: 'usage' },
        { quote_item_id: 'ql-2', description: 'Managed User Seat - Branch Offices', quantity: 80, unit_price: 8500, total_price: 680000, tax_amount: 54400, net_amount: 734400, is_optional: false, is_selected: true, is_recurring: true, billing_frequency: 'monthly', billing_method: 'usage' },
        { quote_item_id: 'ql-3', description: 'Security Awareness Training', quantity: 125, unit_price: 600, total_price: 75000, tax_amount: 6000, net_amount: 81000, is_optional: false, is_selected: true, is_recurring: true, billing_frequency: 'quarterly', billing_method: 'usage' },
        { quote_item_id: 'ql-4', description: 'Endpoint Backup Add-on', quantity: 125, unit_price: 1200, total_price: 150000, tax_amount: 12000, net_amount: 162000, is_optional: true, is_selected: true, is_recurring: true, billing_frequency: 'monthly', billing_method: 'usage' },
        { quote_item_id: 'ql-5', description: 'SOC Alert Triage', quantity: 1, unit_price: 250000, total_price: 250000, tax_amount: 20000, net_amount: 270000, is_optional: false, is_selected: true, is_recurring: true, billing_frequency: 'monthly', billing_method: 'fixed' },
        { quote_item_id: 'ql-6', description: 'After Hours On-Call Support', quantity: 1, unit_price: 180000, total_price: 180000, tax_amount: 14400, net_amount: 194400, is_optional: true, is_selected: false, is_recurring: true, billing_frequency: 'monthly', billing_method: 'fixed' },
        { quote_item_id: 'ql-7', description: 'Network Infrastructure Audit', quantity: 1, unit_price: 450000, total_price: 450000, tax_amount: 36000, net_amount: 486000, is_optional: false, is_selected: true, is_recurring: false, billing_method: 'fixed' },
      ],
      subtotal: 2212500,
      tax: 177000,
      total_amount: 2389500,
    },
  }),
];

export const DEFAULT_QUOTE_PREVIEW_SAMPLE_ID = QUOTE_PREVIEW_SAMPLE_SCENARIOS[0]?.id ?? null;

export const getQuotePreviewSampleScenarioById = (scenarioId: string | null) =>
  QUOTE_PREVIEW_SAMPLE_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null;
