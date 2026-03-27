// server/src/config/menuConfig.ts

import type { ElementType } from 'react';
import { TIER_FEATURES } from '@alga-psa/types';
import {
  AtSign,
  BarChart3,
  Bell,
  BookOpen,
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
  FlaskConical,
  Globe,
  Gauge,
  Handshake,
  HelpCircle,
  Home,
  KeyRound,
  Layers,
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
  Timer,
  User,
  UserCog,
  Users,
  Star
} from 'lucide-react';

// Navigation modes for the unified sidebar
export type NavMode = 'main' | 'settings' | 'billing' | 'extensions';

export interface MenuItem {
  name: string;
  icon: ElementType;
  translationKey?: string;
  href?: string;
  subItems?: MenuItem[];
  requiredFeature?: TIER_FEATURES;
  underConstruction?: boolean;
}

export interface NavigationSection {
  title: string;
  translationKey?: string;
  items: MenuItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    title: '',
    items: [
      {
        name: 'Home',
        translationKey: 'nav.home',
        icon: Home,
        href: '/msp/dashboard'
      },
      {
        name: 'User Activities',
        translationKey: 'nav.userActivities',
        icon: BarChart3,
        href: '/msp/user-activities'
      },
      {
        name: 'Tickets',
        translationKey: 'nav.tickets',
        icon: MessageSquare,
        href: '/msp/tickets'
      },
      {
        name: 'Surveys',
        translationKey: 'nav.surveys',
        icon: Star,
        href: '/msp/surveys/dashboard'
      },
      {
        name: 'Projects',
        translationKey: 'nav.projects',
        icon: Layers,
        subItems: [
          { name: 'All Projects', translationKey: 'nav.projectsAll', icon: Layers, href: '/msp/projects' },
          { name: 'Templates', translationKey: 'nav.projectsTemplates', icon: FileText, href: '/msp/projects/templates' }
        ]
      },
      {
        name: 'Clients',
        translationKey: 'nav.clients',
        icon: Building2,
        href: '/msp/clients'
      },
      {
        name: 'Contacts',
        translationKey: 'nav.contacts',
        icon: Users,
        href: '/msp/contacts'
      },
      {
        name: 'Documents',
        translationKey: 'nav.documents',
        icon: FileText,
        subItems: [
          { name: 'All Documents', translationKey: 'nav.documentsAll', icon: FileText, href: '/msp/documents' },
          { name: 'Knowledge Base', translationKey: 'nav.knowledgeBase', icon: BookOpen, href: '/msp/knowledge-base' }
        ]
      },
      {
        name: 'Assets',
        translationKey: 'nav.assets',
        icon: Monitor,
        href: '/msp/assets'
      },
      {
        name: 'Time Management',
        translationKey: 'nav.timeManagement',
        icon: Clock,
        subItems: [
          { name: 'Time Entry', translationKey: 'nav.timeEntry', icon: Clock, href: '/msp/time-entry' },
          { name: 'Approvals', translationKey: 'nav.approvals', icon: CheckCircle, href: '/msp/time-sheet-approvals' },
        ]
      },
      {
        name: 'Billing',
        translationKey: 'nav.billing.label',
        icon: CreditCard,
        href: '/msp/billing?tab=client-contracts'
      },
      {
        name: 'Schedule',
        translationKey: 'nav.schedule',
        icon: Calendar,
        href: '/msp/schedule'
      },
      {
        name: 'Technician Dispatch',
        translationKey: 'nav.technicianDispatch',
        icon: MapPin,
        href: '/msp/technician-dispatch'
      },
      {
        name: 'Workflows',
        translationKey: 'nav.workflows',
        icon: Rocket,
        subItems: [
          { name: 'Control Panel', translationKey: 'nav.controlPanel', icon: Gauge, href: '/msp/workflow-control' },
          {
            name: 'Workflow Editor',
            translationKey: 'nav.workflowEditor',
            icon: ListTree,
            href: '/msp/workflow-editor',
            requiredFeature: TIER_FEATURES.WORKFLOW_DESIGNER,
          },
        ]
      },
      {
        name: 'System Monitoring',
        translationKey: 'nav.systemMonitoring',
        icon: LayoutDashboard,
        subItems: [
          { name: 'Job Monitoring', translationKey: 'nav.jobMonitoring', icon: LayoutDashboard, href: '/msp/jobs' },
          { name: 'Email Logs', translationKey: 'nav.emailLogs', icon: Mail, href: '/msp/email-logs' },
        ]
      },
      {
        name: 'Extensions',
        translationKey: 'nav.extensions',
        icon: Puzzle,
        href: '/msp/extensions',
        requiredFeature: TIER_FEATURES.EXTENSIONS,
      }
    ]
  }
];

export const menuItems: MenuItem[] = navigationSections.flatMap((section) => section.items);

export const bottomMenuItems: MenuItem[] = [
  {
    name: 'Settings',
    translationKey: 'sidebar.settings',
    icon: Settings,
    subItems: [
      { name: 'General', translationKey: 'settings.tabs.general', icon: SlidersHorizontal, href: '/msp/settings' },
      { name: 'Profile', translationKey: 'settings.tabs.profile', icon: User, href: '/msp/profile' },
      {
        name: 'Security',
        translationKey: 'settings.tabs.security',
        href: '/msp/security-settings',
        icon: Shield,
      },
    ]
  },
  { name: 'Support', translationKey: 'sidebar.support', icon: HelpCircle, href: 'https://www.nineminds.com/support' },
];

// Settings navigation sections - used when sidebar is in 'settings' mode
// These correspond to the settings tabs in SettingsPage
export const settingsNavigationSections: NavigationSection[] = [
  {
    title: 'Organization & Access',
    translationKey: 'settings.sections.organizationAccess',
    items: [
      { name: 'General', translationKey: 'settings.tabs.general', icon: Settings, href: '/msp/settings?tab=general' },
      { name: 'Users', translationKey: 'settings.tabs.users', icon: UserCog, href: '/msp/settings?tab=users' },
      { name: 'Teams', translationKey: 'settings.tabs.teams', icon: Users, href: '/msp/settings?tab=teams' },
      { name: 'Language', translationKey: 'settings.tabs.language', icon: Globe, href: '/msp/settings?tab=language' },
      { name: 'Client Portal', translationKey: 'settings.tabs.clientPortal', icon: AtSign, href: '/msp/settings?tab=client-portal' },
    ]
  },
  {
    title: 'Work Management',
    translationKey: 'settings.sections.workManagement',
    items: [
      { name: 'Ticketing', translationKey: 'settings.tabs.ticketing', icon: MessageSquare, href: '/msp/settings?tab=ticketing' },
      { name: 'SLA', translationKey: 'settings.tabs.sla', icon: Timer, href: '/msp/settings/sla' },
      { name: 'Projects', translationKey: 'settings.tabs.projects', icon: Layers, href: '/msp/settings?tab=projects' },
      { name: 'Interactions', translationKey: 'settings.tabs.interactions', icon: Handshake, href: '/msp/settings?tab=interactions' },
    ]
  },
  {
    title: 'Time & Billing',
    translationKey: 'settings.sections.timeBilling',
    items: [
      { name: 'Time Entry', translationKey: 'settings.tabs.timeEntry', icon: Clock, href: '/msp/settings?tab=time-entry' },
      { name: 'Billing', translationKey: 'settings.tabs.billing', icon: CreditCard, href: '/msp/settings?tab=billing' },
    ]
  },
  {
    title: 'Communication',
    translationKey: 'settings.sections.communication',
    items: [
      { name: 'Notifications', translationKey: 'settings.tabs.notifications', icon: Bell, href: '/msp/settings?tab=notifications' },
      { name: 'Email', translationKey: 'settings.tabs.email', icon: Mail, href: '/msp/settings?tab=email' },
    ]
  },
  {
    title: 'Data & Integration',
    translationKey: 'settings.sections.dataIntegration',
    items: [
      { name: 'Secrets', translationKey: 'settings.tabs.secrets', icon: KeyRound, href: '/msp/settings?tab=secrets' },
      { name: 'Import/Export', translationKey: 'settings.tabs.importExport', icon: Download, href: '/msp/settings?tab=import-export' },
      { name: 'Integrations', translationKey: 'settings.tabs.integrations', icon: Plug, href: '/msp/settings?tab=integrations' },
      { name: 'Extensions', translationKey: 'settings.tabs.extensions', icon: Puzzle, href: '/msp/settings?tab=extensions' },
    ]
  },
  {
    title: 'Experimental',
    translationKey: 'settings.sections.experimental',
    items: [
      { name: 'Experimental Features', translationKey: 'settings.tabs.experimentalFeatures', icon: FlaskConical, href: '/msp/settings?tab=experimental-features' },
    ]
  },
];

// Extensions navigation sections - used when sidebar is in 'extensions' mode
export const extensionsNavigationSections: NavigationSection[] = [
  {
    title: '',
    items: [
      { name: 'Settings', translationKey: 'sidebar.settings', icon: Settings, href: '/msp/extensions' },
    ]
  }
];

// Billing navigation sections - used when sidebar is in 'billing' mode
export const billingNavigationSections: NavigationSection[] = [
  {
    title: 'Contracts',
    translationKey: 'nav.billing.sections.contracts',
    items: [
      { name: 'Contract Templates', translationKey: 'nav.billing.contractTemplates', icon: LayoutTemplate, href: '/msp/billing?tab=contract-templates' },
      { name: 'Client Contracts', translationKey: 'nav.billing.clientContracts', icon: FileSignature, href: '/msp/billing?tab=client-contracts' },
      { name: 'Contract Line Presets', translationKey: 'nav.billing.contractLinePresets', icon: ListTree, href: '/msp/billing?tab=contract-lines' },
    ]
  },
  {
    title: 'Invoicing',
    translationKey: 'nav.billing.sections.invoicing',
    items: [
      { name: 'Invoicing', translationKey: 'nav.billing.invoicing', icon: Receipt, href: '/msp/billing?tab=invoicing' },
      { name: 'Invoice Layouts', translationKey: 'nav.billing.invoiceLayouts', icon: ReceiptText, href: '/msp/billing?tab=invoice-templates' },
      { name: 'Billing Cycles', translationKey: 'nav.billing.billingCycles', icon: CalendarClock, href: '/msp/billing?tab=billing-cycles' },
      { name: 'Service Periods', translationKey: 'nav.billing.servicePeriods', icon: CalendarClock, href: '/msp/billing?tab=service-periods' },
    ]
  },
  {
    title: 'Quotes',
    translationKey: 'nav.billing.sections.quotes',
    items: [
      { name: 'Quotes', translationKey: 'nav.billing.quotes', icon: FileText, href: '/msp/billing?tab=quotes' },
      { name: 'Quote Templates', translationKey: 'nav.billing.quoteBusinessTemplates', icon: FileText, href: '/msp/billing?tab=quote-business-templates' },
      { name: 'Quote Layouts', translationKey: 'nav.billing.quoteLayouts', icon: LayoutTemplate, href: '/msp/billing?tab=quote-templates' },
    ]
  },
  {
    title: 'Pricing',
    translationKey: 'nav.billing.sections.pricing',
    items: [
      { name: 'Service Catalog', translationKey: 'nav.billing.serviceCatalog', icon: Package, href: '/msp/billing?tab=service-catalog' },
      { name: 'Products', translationKey: 'nav.billing.products', icon: Package, href: '/msp/billing?tab=products' },
      { name: 'Tax Rates', translationKey: 'nav.billing.taxRates', icon: Percent, href: '/msp/billing?tab=tax-rates' },
    ]
  },
  {
    title: 'Tracking & Reports',
    translationKey: 'nav.billing.sections.trackingReports',
    items: [
      { name: 'Usage Tracking', translationKey: 'nav.billing.usageTracking', icon: Gauge, href: '/msp/billing?tab=usage-tracking' },
      { name: 'Reports', translationKey: 'nav.billing.reports', icon: FileBarChart, href: '/msp/billing?tab=reports' },
      { name: 'Accounting Exports', translationKey: 'nav.billing.accountingExports', icon: FileOutput, href: '/msp/billing?tab=accounting-exports' },
    ]
  }
];
