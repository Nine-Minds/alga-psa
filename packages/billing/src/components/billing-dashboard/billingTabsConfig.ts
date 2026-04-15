import {
  FileText,
  FilePlus,
  FileMinus,
  FileOutput,
  Percent,
  Layers3,
  Calendar,
  Gauge,
  BarChart3,
  Package
} from 'lucide-react';

export interface BillingTabDefinition {
  value: BillingTabValue;
  label: string;
  labelKey: string;
  href: string;
  icon: React.ElementType;
}

export type BillingTabValue =
  | 'contract-templates'
  | 'client-contracts'
  | 'quotes'
  | 'quote-templates'
  | 'quote-business-templates'
  | 'accounting-exports'
  | 'contract-lines'
  | 'invoicing'
  | 'invoice-templates'
  | 'billing-cycles'
  | 'service-periods'
  | 'products'
  | 'service-catalog'
  | 'tax-rates'
  | 'usage-tracking'
  | 'reports';

export const billingTabDefinitions: BillingTabDefinition[] = [
  {
    value: 'quotes',
    label: 'Quotes',
    labelKey: 'dashboard.tabs.quotes',
    href: '/msp/billing?tab=quotes',
    icon: FileText
  },
  {
    value: 'quote-templates',
    label: 'Quote Layouts',
    labelKey: 'dashboard.tabs.quoteLayouts',
    href: '/msp/billing?tab=quote-templates',
    icon: FileMinus
  },
  {
    value: 'quote-business-templates',
    label: 'Quote Templates',
    labelKey: 'dashboard.tabs.quoteTemplates',
    href: '/msp/billing?tab=quote-business-templates',
    icon: FileText
  },
  {
    value: 'client-contracts',
    label: 'Client Contracts',
    labelKey: 'dashboard.tabs.clientContracts',
    href: '/msp/billing?tab=client-contracts',
    icon: FileText
  },
  {
    value: 'accounting-exports',
    label: 'Accounting Exports',
    labelKey: 'dashboard.tabs.accountingExports',
    href: '/msp/billing?tab=accounting-exports',
    icon: FileOutput
  },
  {
    value: 'contract-templates',
    label: 'Contract Templates',
    labelKey: 'dashboard.tabs.contractTemplates',
    href: '/msp/billing?tab=contract-templates',
    icon: FileText
  },
  {
    value: 'invoicing',
    label: 'Invoicing',
    labelKey: 'dashboard.tabs.invoicing',
    href: '/msp/billing?tab=invoicing',
    icon: FilePlus
  },
  {
    value: 'invoice-templates',
    label: 'Invoice Layouts',
    labelKey: 'dashboard.tabs.invoiceLayouts',
    href: '/msp/billing?tab=invoice-templates',
    icon: FileMinus
  },
  {
    value: 'tax-rates',
    label: 'Tax Rates',
    labelKey: 'dashboard.tabs.taxRates',
    href: '/msp/billing?tab=tax-rates',
    icon: Percent
  },
  {
    value: 'contract-lines',
    label: 'Contract Line Presets',
    labelKey: 'dashboard.tabs.contractLinePresets',
    href: '/msp/billing?tab=contract-lines',
    icon: Layers3
  },
  {
    value: 'billing-cycles',
    label: 'Billing Cycles',
    labelKey: 'dashboard.tabs.billingCycles',
    href: '/msp/billing?tab=billing-cycles',
    icon: Calendar
  },
  {
    value: 'service-periods',
    label: 'Service Periods',
    labelKey: 'dashboard.tabs.servicePeriods',
    href: '/msp/billing?tab=service-periods',
    icon: Calendar
  },
  {
    value: 'usage-tracking',
    label: 'Usage Tracking',
    labelKey: 'dashboard.tabs.usageTracking',
    href: '/msp/billing?tab=usage-tracking',
    icon: Gauge
  },
  {
    value: 'reports',
    label: 'Reports',
    labelKey: 'dashboard.tabs.reports',
    href: '/msp/billing?tab=reports',
    icon: BarChart3
  },
  {
    value: 'service-catalog',
    label: 'Service Catalog',
    labelKey: 'dashboard.tabs.serviceCatalog',
    href: '/msp/billing?tab=service-catalog',
    icon: Package
  },
  {
    value: 'products',
    label: 'Products',
    labelKey: 'dashboard.tabs.products',
    href: '/msp/billing?tab=products',
    icon: Package
  }
];
