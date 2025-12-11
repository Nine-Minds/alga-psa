import {
  FileText,
  FilePlus,
  FileMinus,
  Percent,
  Layers3,
  Calendar,
  Gauge,
  BarChart3,
  Package,
  Coins
} from 'lucide-react';

export interface BillingTabDefinition {
  value: BillingTabValue;
  label: string;
  href: string;
  icon: React.ElementType;
}

export type BillingTabValue =
  | 'contract-templates'
  | 'client-contracts'
  | 'contract-lines'
  | 'invoicing'
  | 'invoice-templates'
  | 'billing-cycles'
  | 'service-catalog'
  | 'tax-rates'
  | 'usage-tracking'
  | 'reports'
  | 'accounting-exports';

export const billingTabDefinitions: BillingTabDefinition[] = [
  {
    value: 'client-contracts',
    label: 'Client Contracts',
    href: '/msp/billing?tab=client-contracts',
    icon: FileText
  },
  {
    value: 'contract-templates',
    label: 'Contract Templates',
    href: '/msp/billing?tab=contract-templates',
    icon: FileText
  },
  {
    value: 'invoicing',
    label: 'Invoicing',
    href: '/msp/billing?tab=invoicing',
    icon: FilePlus
  },
  {
    value: 'invoice-templates',
    label: 'Invoice Templates',
    href: '/msp/billing?tab=invoice-templates',
    icon: FileMinus
  },
  {
    value: 'tax-rates',
    label: 'Tax Rates',
    href: '/msp/billing?tab=tax-rates',
    icon: Percent
  },
  {
    value: 'contract-lines',
    label: 'Contract Line Presets',
    href: '/msp/billing?tab=contract-lines',
    icon: Layers3
  },
  {
    value: 'billing-cycles',
    label: 'Billing Cycles',
    href: '/msp/billing?tab=billing-cycles',
    icon: Calendar
  },
  {
    value: 'usage-tracking',
    label: 'Usage Tracking',
    href: '/msp/billing?tab=usage-tracking',
    icon: Gauge
  },
  {
    value: 'reports',
    label: 'Reports',
    href: '/msp/billing?tab=reports',
    icon: BarChart3
  },
  {
    value: 'service-catalog',
    label: 'Service Catalog',
    href: '/msp/billing?tab=service-catalog',
    icon: Package
  },
  {
    value: 'accounting-exports',
    label: 'Accounting Exports',
    href: '/msp/billing?tab=accounting-exports',
    icon: Coins
  }
];
