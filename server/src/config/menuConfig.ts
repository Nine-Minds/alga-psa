// server/src/config/sidebarNavigationConfig.ts

import * as RadixIcons from '@radix-ui/react-icons';
import { CreditCard, PercentIcon } from 'lucide-react';

export interface MenuItem {
  name: string;
  icon: React.ElementType;
  href?: string;
  subItems?: MenuItem[];
}

export const menuItems: MenuItem[] = [
  {
    name: 'Dashboard',
    icon: RadixIcons.BarChartIcon,
    href: '/msp/dashboard'  // Updated to point to our new dashboard page
  },
  {
    name: 'User Activities',
    icon: RadixIcons.ActivityLogIcon,
    href: '/msp/user-activities'
  },
  {
    name: 'Tickets',
    icon: RadixIcons.ChatBubbleIcon,
    href: '/msp/tickets'
  },
  {
    name: 'Projects',
    icon: RadixIcons.LayersIcon,
    href: '/msp/projects'
  },
  {
    name: 'Assets',
    icon: RadixIcons.DesktopIcon,
    href: '/msp/assets'
  },
  {
    name: 'Clients',
    icon: RadixIcons.CubeIcon,
    href: '/msp/companies'
  },
  {
    name: 'Contacts',
    icon: RadixIcons.PersonIcon,
    href: '/msp/contacts'
  },
  {
    name: 'Documents',
    icon: RadixIcons.FileIcon,
    href: '/msp/documents'
  },
  {
    name: 'Time Management',
    icon: RadixIcons.TimerIcon,
    subItems: [
      { name: 'Time Entry', icon: RadixIcons.ClockIcon, href: '/msp/time-entry' },
      { name: 'Time Sheet Approvals', icon: RadixIcons.CheckCircledIcon, href: '/msp/time-sheet-approvals' },
    ]
  },
  {
    name: 'Billing',
    icon: CreditCard,
    subItems: [
      {
        name: 'Overview',
        icon: RadixIcons.DashboardIcon,
        href: '/msp/billing?tab=overview'
      },
      {
        name: 'Generate Invoices',
        icon: RadixIcons.FilePlusIcon,
        href: '/msp/billing?tab=generate-invoices'
      },
      {
        name: 'Invoices',
        icon: RadixIcons.FileTextIcon,
        href: '/msp/billing?tab=invoices'
      },
      {
        name: 'Invoice Templates',
        icon: RadixIcons.FileMinusIcon,
        href: '/msp/billing?tab=invoice-templates'
      },
      {
        name: 'Tax Rates',
        icon: PercentIcon,
        href: '/msp/billing?tab=tax-rates'
      },
      {
        name: 'Plans',
        icon: RadixIcons.CardStackIcon,
        href: '/msp/billing?tab=plans'
      },
      {
        name: 'Plan Bundles',
        icon: RadixIcons.BoxIcon,
        href: '/msp/billing?tab=plan-bundles'
      },
      {
        name: 'Service Catalog',
        icon: RadixIcons.StackIcon,
        href: '/msp/billing?tab=service-catalog'
      },
      {
        name: 'Billing Cycles',
        icon: RadixIcons.CalendarIcon,
        href: '/msp/billing?tab=billing-cycles'
      },
      {
        name: 'Time Periods',
        icon: RadixIcons.ClockIcon,
        href: '/msp/billing?tab=time-periods'
      },
      {
        name: 'Usage Tracking',
        icon: RadixIcons.TimerIcon,
        href: '/msp/billing?tab=usage-tracking'
      },
      {
        name: 'Credits',
        icon: CreditCard,
        href: '/msp/billing?tab=credits'
      },
      {
        name: 'Reconciliation',
        icon: RadixIcons.CheckCircledIcon,
        href: '/msp/billing?tab=reconciliation'
      }
    ]
  },
  {
    name: 'Schedule',
    icon: RadixIcons.CalendarIcon,
    href: '/msp/schedule'
  },
  {
    name: 'Technician Dispatch',
    icon: RadixIcons.PersonIcon,
    href: '/msp/technician-dispatch'
  },
  {
    name: 'Automation Hub',
    icon: RadixIcons.RocketIcon,
    href: '/msp/automation-hub',
    subItems: [
      {
        name: 'Template Library',
        icon: RadixIcons.LayoutIcon,
        href: '/msp/automation-hub?tab=template-library'
      },
      {
        name: 'Workflows',
        icon: RadixIcons.CodeIcon,
        href: '/msp/automation-hub?tab=workflows'
      },
      {
        name: 'Events Catalog',
        icon: RadixIcons.BellIcon,
        href: '/msp/automation-hub?tab=events-catalog'
      },
      {
        name: 'Logs & History',
        icon: RadixIcons.ClockIcon,
        href: '/msp/automation-hub?tab=logs-history'
      }
    ]
  },
  {
    name: 'System',
    icon: RadixIcons.GearIcon,
    subItems: [
      {
        name: 'Job Monitoring',
        icon: RadixIcons.DashboardIcon,
        href: '/msp/jobs'
      }
    ]
  }
];

export const bottomMenuItems: MenuItem[] = [
  { 
    name: 'Settings', 
    icon: RadixIcons.GearIcon,
    subItems: [
      { name: 'General', icon: RadixIcons.MixerHorizontalIcon, href: '/msp/settings' },
      { name: 'Profile', icon: RadixIcons.PersonIcon, href: '/msp/profile' },
      {
        name: 'Security',
        href: '/msp/security-settings',
        icon: RadixIcons.LockClosedIcon,
      },
    ]
  },
  { name: 'Support', icon: RadixIcons.QuestionMarkCircledIcon },
];
