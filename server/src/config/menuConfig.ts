// server/src/config/sidebarNavigationConfig.ts

import type { ElementType } from 'react';
import {
  AtSign,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  FileBarChart,
  FileOutput,
  FileSignature,
  FileText,
  Gauge,
  Globe,
  Handshake,
  HelpCircle,
  Home,
  Layers,
  Layout,
  LayoutDashboard,
  LayoutTemplate,
  ListTree,
  Mail,
  MapPin,
  MessageSquare,
  Monitor,
  Package,
  Percent,
  Plug,
  Puzzle,
  Receipt,
  ReceiptText,
  Rocket,
  Settings,
  Shield,
  SlidersHorizontal,
  User,
  UserCog,
  Users,
  Workflow,
  Star
} from 'lucide-react';
import { billingTabDefinitions } from '../components/billing-dashboard/billingTabsConfig';

// Navigation modes for the unified sidebar
export type NavMode = 'main' | 'settings' | 'billing';

export interface MenuItem {
  name: string;
  icon: ElementType;
  href?: string;
  subItems?: MenuItem[];
  underConstruction?: boolean;
}

export interface NavigationSection {
  title: string;
  items: MenuItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    title: '',
    items: [
      {
        name: 'Home',
        icon: Home,
        href: '/msp/dashboard'
      },
      {
        name: 'User Activities',
        icon: BarChart3,
        href: '/msp/user-activities'
      },
      {
        name: 'Tickets',
        icon: MessageSquare,
        href: '/msp/tickets'
      },
      {
        name: 'Surveys',
        icon: Star,
        href: '/msp/surveys/dashboard'
      },
      {
        name: 'Projects',
        icon: Layers,
        href: '/msp/projects',
        subItems: [
          { name: 'All Projects', icon: Layers, href: '/msp/projects' },
          { name: 'Templates', icon: FileText, href: '/msp/projects/templates' }
        ]
      },
      {
        name: 'Clients',
        icon: Building2,
        href: '/msp/clients'
      },
      {
        name: 'Contacts',
        icon: Users,
        href: '/msp/contacts'
      },
      {
        name: 'Documents',
        icon: FileText,
        href: '/msp/documents'
      },
      {
        name: 'Assets',
        icon: Monitor,
        href: '/msp/assets'
      },
      {
        name: 'Time Management',
        icon: Clock,
        subItems: [
          { name: 'Time Entry', icon: Clock, href: '/msp/time-entry' },
          { name: 'Approvals', icon: CheckCircle, href: '/msp/time-sheet-approvals' },
        ]
      },
      {
        name: 'Billing',
        icon: CreditCard,
        href: '/msp/billing?tab=client-contracts'
      },
      {
        name: 'Schedule',
        icon: Calendar,
        href: '/msp/schedule'
      },
      {
        name: 'Technician Dispatch',
        icon: MapPin,
        href: '/msp/technician-dispatch'
      },
      {
        name: 'Automation Hub',
        icon: Rocket,
        href: '/msp/automation-hub',
        subItems: [
          {
            name: 'Template Library',
            icon: Layout,
            href: '/msp/automation-hub?tab=template-library'
          },
          {
            name: 'Workflows',
            icon: Workflow,
            href: '/msp/automation-hub?tab=workflows'
          },
          {
            name: 'Events Catalog',
            icon: Bell,
            href: '/msp/automation-hub?tab=events-catalog'
          },
          {
            name: 'Logs & History',
            icon: Clock,
            href: '/msp/automation-hub?tab=logs-history'
          }
        ]
      },
      {
        name: 'System Monitor',
        icon: LayoutDashboard,
        href: '/msp/jobs'
      }
    ]
  }
];

export const menuItems: MenuItem[] = navigationSections.flatMap((section) => section.items);

export const bottomMenuItems: MenuItem[] = [
  {
    name: 'Settings',
    icon: Settings,
    subItems: [
      { name: 'General', icon: SlidersHorizontal, href: '/msp/settings' },
      { name: 'Profile', icon: User, href: '/msp/profile' },
      {
        name: 'Security',
        href: '/msp/security-settings',
        icon: Shield,
      },
    ]
  },
  { name: 'Support', icon: HelpCircle, href: 'https://www.nineminds.com/support' },
];

// Settings navigation sections - used when sidebar is in 'settings' mode
// These correspond to the settings tabs in SettingsPage
export const settingsNavigationSections: NavigationSection[] = [
  {
    title: 'Organization & Access',
    items: [
      { name: 'General', icon: Settings, href: '/msp/settings?tab=general' },
      { name: 'Users', icon: UserCog, href: '/msp/settings?tab=users' },
      { name: 'Teams', icon: Users, href: '/msp/settings?tab=teams' },
      { name: 'Client Portal', icon: AtSign, href: '/msp/settings?tab=client-portal' },
    ]
  },
  {
    title: 'Work Management',
    items: [
      { name: 'Ticketing', icon: MessageSquare, href: '/msp/settings?tab=ticketing' },
      { name: 'Projects', icon: Layers, href: '/msp/settings?tab=projects' },
      { name: 'Interactions', icon: Handshake, href: '/msp/settings?tab=interactions' },
    ]
  },
  {
    title: 'Time & Billing',
    items: [
      { name: 'Time Entry', icon: Clock, href: '/msp/settings?tab=time-entry' },
      { name: 'Billing', icon: CreditCard, href: '/msp/settings?tab=billing' },
    ]
  },
  {
    title: 'Communication',
    items: [
      { name: 'Notifications', icon: Bell, href: '/msp/settings?tab=notifications' },
      { name: 'Email', icon: Mail, href: '/msp/settings?tab=email' },
    ]
  },
  {
    title: 'Data & Integration',
    items: [
      { name: 'Import/Export', icon: Download, href: '/msp/settings?tab=import-export' },
      { name: 'Integrations', icon: Plug, href: '/msp/settings?tab=integrations' },
      { name: 'Extensions', icon: Puzzle, href: '/msp/settings?tab=extensions' },
    ]
  }
];

// Billing navigation sections - used when sidebar is in 'billing' mode
export const billingNavigationSections: NavigationSection[] = [
  {
    title: 'Contracts',
    items: [
      { name: 'Contract Templates', icon: LayoutTemplate, href: '/msp/billing?tab=contract-templates' },
      { name: 'Client Contracts', icon: FileSignature, href: '/msp/billing?tab=client-contracts' },
      { name: 'Contract Line Presets', icon: ListTree, href: '/msp/billing?tab=contract-lines' },
    ]
  },
  {
    title: 'Invoicing',
    items: [
      { name: 'Invoicing', icon: Receipt, href: '/msp/billing?tab=invoicing' },
      { name: 'Invoice Templates', icon: ReceiptText, href: '/msp/billing?tab=invoice-templates' },
      { name: 'Billing Cycles', icon: CalendarClock, href: '/msp/billing?tab=billing-cycles' },
    ]
  },
  {
    title: 'Pricing',
    items: [
      { name: 'Service Catalog', icon: Package, href: '/msp/billing?tab=service-catalog' },
      { name: 'Tax Rates', icon: Percent, href: '/msp/billing?tab=tax-rates' },
    ]
  },
  {
    title: 'Tracking & Reports',
    items: [
      { name: 'Usage Tracking', icon: Gauge, href: '/msp/billing?tab=usage-tracking' },
      { name: 'Reports', icon: FileBarChart, href: '/msp/billing?tab=reports' },
      { name: 'Accounting Exports', icon: FileOutput, href: '/msp/billing?tab=accounting-exports' },
    ]
  }
];
