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
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Download,
  FileBarChart,
  FileOutput,
  FileSignature,
  FileText,
  FlaskConical,
  Globe,
  Gauge,
  Ghost,
  Handshake,
  HelpCircle,
  Home,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LayoutTemplate,
  ListTodo,
  ListChecks,
  ListTree,
  Mail,
  MapPin,
  Megaphone,
  Monitor,
  Package,
  Palette,
  Percent,
  Plug,
  Puzzle,
  Receipt,
  ReceiptText,
  Rocket,
  Settings,
  Share2,
  Shield,
  SlidersHorizontal,
  SquareDashedKanban,
  Timer,
  User,
  UserCog,
  Users,
  Star,
  Target,
  Ticket,
  BadgeCheck,
  Wrench
} from 'lucide-react';

// Navigation modes for the unified sidebar
export type NavMode = 'main' | 'settings' | 'billing' | 'extensions' | 'inventory';
export type MenuEdition = 'community' | 'enterprise';

const ENTERPRISE_ONLY_EDITIONS: readonly MenuEdition[] = ['enterprise'];

export interface MenuItem {
  name: string;
  icon: ElementType;
  translationKey?: string;
  href?: string;
  subItems?: MenuItem[];
  requiredFeature?: TIER_FEATURES;
  availableEditions?: readonly MenuEdition[];
  underConstruction?: boolean;
  requiresSelfHost?: boolean;
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
        icon: Ticket,
        href: '/msp/tickets'
      },
      {
        name: 'Service Requests',
        translationKey: 'nav.serviceRequests',
        icon: LayoutTemplate,
        href: '/msp/service-requests'
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
        icon: ListTodo,
        subItems: [
          { name: 'All Projects', translationKey: 'nav.projectsAll', icon: ListTodo, href: '/msp/projects' },
          { name: 'Templates', translationKey: 'nav.projectsTemplates', icon: SquareDashedKanban, href: '/msp/projects/templates' }
        ]
      },
      {
        name: 'Clients',
        translationKey: 'nav.clients',
        icon: Building2,
        href: '/msp/clients'
      },
      {
        name: 'Opportunities',
        translationKey: 'nav.opportunities',
        icon: Target,
        href: '/msp/opportunities'
      },
      {
        name: 'Marketing',
        translationKey: 'nav.marketing.label',
        icon: Megaphone,
        subItems: [
          { name: 'Calendar', translationKey: 'nav.marketing.calendar', icon: Calendar, href: '/msp/marketing/calendar' },
          { name: 'Posts', translationKey: 'nav.marketing.posts', icon: Share2, href: '/msp/marketing/posts' },
          { name: 'Content', translationKey: 'nav.marketing.content', icon: FileText, href: '/msp/marketing/content' },
          { name: 'Campaigns', translationKey: 'nav.marketing.campaigns', icon: Target, href: '/msp/marketing/campaigns' },
          { name: 'Sequences', translationKey: 'nav.marketing.sequences', icon: Mail, href: '/msp/marketing/sequences' },
          { name: 'Forms', translationKey: 'nav.marketing.forms', icon: ClipboardList, href: '/msp/marketing/forms' },
          { name: 'Channels', translationKey: 'nav.marketing.channels', icon: AtSign, href: '/msp/marketing/channels' }
        ]
      },
      {
        name: 'Contacts',
        translationKey: 'nav.contacts',
        icon: Users,
        href: '/msp/contacts'
      },
      {
        name: 'Interactions',
        translationKey: 'nav.interactions',
        icon: Handshake,
        href: '/msp/interactions'
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
        subItems: [
          { name: 'All Assets', translationKey: 'nav.assetsAll', icon: Monitor, href: '/msp/assets' },
          { name: 'Maintenance', translationKey: 'nav.assetsMaintenance', icon: Wrench, href: '/msp/assets/maintenance' }
        ]
      },
      {
        name: 'Passwords',
        translationKey: 'nav.passwords',
        icon: KeyRound,
        href: '/msp/credentials',
        requiredFeature: TIER_FEATURES.CREDENTIALS,
        availableEditions: ENTERPRISE_ONLY_EDITIONS,
      },
      {
        name: 'Inventory',
        translationKey: 'nav.inventory.label',
        icon: Package,
        href: '/msp/inventory'
      },
      {
        name: 'Reports',
        translationKey: 'nav.billing.reports',
        icon: FileBarChart,
        href: '/msp/reports'
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
          {
            name: 'Control Panel',
            translationKey: 'nav.controlPanel',
            icon: Gauge,
            href: '/msp/workflow-control',
            availableEditions: ENTERPRISE_ONLY_EDITIONS,
          },
          {
            name: 'Workflow Editor',
            translationKey: 'nav.workflowEditor',
            icon: ListTree,
            href: '/msp/workflow-editor',
            availableEditions: ENTERPRISE_ONLY_EDITIONS,
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
        availableEditions: ENTERPRISE_ONLY_EDITIONS,
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
// LEVERAGE: pattern settings-tabs-twice — the settings tab set is defined twice (here, and in SettingsPage.tsx's allTabs builder); the two lists drift. The EE-gated 'mcp-server' tab exists there but is missing here, so it never appears in the side menu. This nav config also has no EE gating primitive (only product + tier), so a gated tab can't be expressed as data. Both lists should derive from one gated registry (cf. providerRegistry.ts requiresEnterprise).
export const settingsNavigationSections: NavigationSection[] = [
  {
    title: 'Organization & Access',
    translationKey: 'settings.sections.organizationAccess',
    items: [
      { name: 'General', translationKey: 'settings.tabs.general', icon: Settings, href: '/msp/settings?tab=general' },
      { name: 'Users', translationKey: 'settings.tabs.users', icon: UserCog, href: '/msp/settings/users' },
      { name: 'Teams', translationKey: 'settings.tabs.teams', icon: Users, href: '/msp/settings?tab=teams' },
      { name: 'Language', translationKey: 'settings.tabs.language', icon: Globe, href: '/msp/settings/language' },
      {
        name: 'Appearance',
        translationKey: 'settings.tabs.appearance',
        icon: Palette,
        href: '/msp/settings/appearance',
        availableEditions: ENTERPRISE_ONLY_EDITIONS,
      },
      { name: 'Client Portal', translationKey: 'settings.tabs.clientPortal', icon: AtSign, href: '/msp/settings/client-portal' },
      { name: 'License', translationKey: 'settings.tabs.license', icon: BadgeCheck, href: '/msp/licenses', requiresSelfHost: true },
    ]
  },
  {
    title: 'Work Management',
    translationKey: 'settings.sections.workManagement',
    items: [
      { name: 'Ticketing', translationKey: 'settings.tabs.ticketing', icon: Ticket, href: '/msp/settings?tab=ticketing' },
      { name: 'SLA', translationKey: 'settings.tabs.sla', icon: Timer, href: '/msp/settings/sla' },
      { name: 'Projects', translationKey: 'settings.tabs.projects', icon: ListTodo, href: '/msp/settings/projects' },
      { name: 'Assets', translationKey: 'settings.tabs.assets', icon: Monitor, href: '/msp/settings/assets' },
      { name: 'Interactions', translationKey: 'settings.tabs.interactions', icon: Handshake, href: '/msp/settings/interactions' },
      { name: 'Opportunities', translationKey: 'settings.tabs.opportunities', icon: Target, href: '/msp/settings/opportunities' },
    ]
  },
  {
    title: 'Time & Billing',
    translationKey: 'settings.sections.timeBilling',
    items: [
      { name: 'Time Entry', translationKey: 'settings.tabs.timeEntry', icon: Clock, href: '/msp/settings/time-entry' },
      { name: 'Billing', translationKey: 'settings.tabs.billing', icon: CreditCard, href: '/msp/settings/billing' },
    ]
  },
  {
    title: 'Communication',
    translationKey: 'settings.sections.communication',
    items: [
      { name: 'Notifications', translationKey: 'settings.tabs.notifications', icon: Bell, href: '/msp/settings?tab=notifications' },
      { name: 'Email', translationKey: 'settings.tabs.email', icon: Mail, href: '/msp/settings/email' },
    ]
  },
  {
    title: 'Data & Integration',
    translationKey: 'settings.sections.dataIntegration',
    items: [
      { name: 'Secrets', translationKey: 'settings.tabs.secrets', icon: KeyRound, href: '/msp/settings/secrets' },
      { name: 'Imports & Exports', translationKey: 'settings.tabs.importExport', icon: Download, href: '/msp/settings/import-export' },
      { name: 'Integrations', translationKey: 'settings.tabs.integrations', icon: Plug, href: '/msp/settings/integrations' },
      {
        name: 'Extensions',
        translationKey: 'settings.tabs.extensions',
        icon: Puzzle,
        href: '/msp/settings?tab=extensions',
        availableEditions: ENTERPRISE_ONLY_EDITIONS,
      },
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

// Inventory navigation sections - used when sidebar is in 'inventory' mode
export const inventoryNavigationSections: NavigationSection[] = [
  {
    title: 'Overview',
    translationKey: 'nav.inventory.sections.overview',
    items: [
      { name: 'Dashboard', translationKey: 'nav.inventoryDashboard', icon: Gauge, href: '/msp/inventory' },
    ]
  },
  {
    title: 'Stock',
    translationKey: 'nav.inventory.sections.stock',
    items: [
      { name: 'Stock', translationKey: 'nav.inventoryStock', icon: Package, href: '/msp/inventory/stock' },
      { name: 'Stock Locations', translationKey: 'nav.inventoryLocations', icon: MapPin, href: '/msp/inventory/locations' },
      { name: 'Stock Units', translationKey: 'nav.inventoryUnits', icon: Layers3, href: '/msp/inventory/units' },
      { name: 'Transfers', translationKey: 'nav.inventoryTransfers', icon: FileOutput, href: '/msp/inventory/transfers' },
      { name: 'Cycle Counts', translationKey: 'nav.inventoryCounts', icon: ListChecks, href: '/msp/inventory/counts' },
      { name: 'Write-offs', translationKey: 'nav.inventoryWriteOffs', icon: FileOutput, href: '/msp/inventory/write-offs' },
    ]
  },
  {
    title: 'Purchasing',
    translationKey: 'nav.inventory.sections.purchasing',
    items: [
      { name: 'Vendors', translationKey: 'nav.inventoryVendors', icon: Handshake, href: '/msp/inventory/vendors' },
      { name: 'Purchase Orders', translationKey: 'nav.inventoryPurchaseOrders', icon: Receipt, href: '/msp/inventory/purchase-orders' },
      { name: 'Vendor Bills', translationKey: 'nav.inventoryVendorBills', icon: Receipt, href: '/msp/inventory/vendor-bills' },
    ]
  },
  {
    title: 'Sales & Fulfillment',
    translationKey: 'nav.inventory.sections.salesFulfillment',
    items: [
      { name: 'Sales Orders', translationKey: 'nav.inventorySalesOrders', icon: ReceiptText, href: '/msp/inventory/sales-orders' },
      { name: 'Document Layouts', translationKey: 'nav.inventoryDocumentLayouts', icon: LayoutTemplate, href: '/msp/document-templates/sales-order' },
      { name: 'RMA', translationKey: 'nav.inventoryRma', icon: ListTree, href: '/msp/inventory/rma' },
      { name: 'Loaners', translationKey: 'nav.inventoryLoaners', icon: Timer, href: '/msp/inventory/loaners' },
      { name: 'Kits', translationKey: 'nav.inventoryKits', icon: Package, href: '/msp/inventory/kits' },
    ]
  },
  {
    title: 'Analytics',
    translationKey: 'nav.inventory.sections.analytics',
    items: [
      { name: 'Margin', translationKey: 'nav.inventoryMargin', icon: Percent, href: '/msp/inventory/margin' },
      { name: 'Ghost Usage', translationKey: 'nav.inventoryGhostUsage', icon: Ghost, href: '/msp/inventory/ghost-usage' },
    ]
  },
];

// Extensions navigation sections - used when sidebar is in 'extensions' mode
export const extensionsNavigationSections: NavigationSection[] = [
  {
    title: '',
    items: [
      {
        name: 'Settings',
        translationKey: 'sidebar.settings',
        icon: Settings,
        href: '/msp/extensions',
        availableEditions: ENTERPRISE_ONLY_EDITIONS,
      },
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
      { name: 'Credits', translationKey: 'nav.billing.credits', icon: Coins, href: '/msp/billing/credits' },
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
      { name: 'Service Types', translationKey: 'nav.billing.serviceTypes', icon: Layers3, href: '/msp/billing?tab=service-types' },
      { name: 'Services', translationKey: 'nav.billing.serviceCatalog', icon: Package, href: '/msp/billing?tab=service-catalog' },
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
