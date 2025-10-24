import {
  FileText,
  FilePlus,
  FileMinus,
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
  href: string;
  icon: React.ElementType;
}

export type BillingTabValue =
  | 'contracts'
  | 'invoicing'
  | 'invoice-templates'
  | 'tax-rates'
  | 'contract-lines'
  | 'billing-cycles'
  | 'usage-tracking'
  | 'reports'
  | 'service-catalog';

export const billingTabDefinitions: BillingTabDefinition[] = [
  {
    value: 'contracts',
    label: 'Contracts',
    href: '/msp/billing?tab=contracts',
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
  }
];
