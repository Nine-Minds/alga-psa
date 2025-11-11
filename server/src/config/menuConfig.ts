// server/src/config/sidebarNavigationConfig.ts

import type { ElementType } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  FolderGit2,
  HelpCircle,
  Home,
  Layers,
  Layout,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Monitor,
  Rocket,
  Settings,
  Shield,
  SlidersHorizontal,
  UploadCloud,
  User,
  Users,
  Workflow
} from 'lucide-react';
import { billingTabDefinitions } from '../components/billing-dashboard/billingTabsConfig';

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

export interface AssetActionItem {
  id: string;
  label: string;
  description: string;
  href?: string;
  icon: ElementType;
  onClickEvent?: string;
}

export const navigationSections: NavigationSection[] = [
  {
    title: 'Workspace',
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
      }
    ]
  },
  {
    title: 'Service Delivery',
    items: [
      {
        name: 'Tickets',
        icon: MessageSquare,
        href: '/msp/tickets'
      },
      {
        name: 'Projects',
        icon: Layers,
        href: '/msp/projects'
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
        href: '/msp/assets',
        subItems: [
          { name: 'Workspace', icon: Layout, href: '/msp/assets' },
          { name: 'Maintenance Plans', icon: Clock, href: '/msp/assets/maintenance' },
          { name: 'Lifecycle Policies', icon: Shield, href: '/msp/assets/policies' },
          { name: 'Automation Rules', icon: Workflow, href: '/msp/assets/automation' },
        ]
      }
    ]
  },
  {
    title: 'Business Operations',
    items: [
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
        subItems: billingTabDefinitions.map(({ label, icon, href }) => ({
          name: label,
          icon,
          href
        }))
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

export const assetActionItems: AssetActionItem[] = [
  {
    id: 'asset-imports',
    label: 'Bulk Imports',
    description: 'Ingest large datasets with mapping templates',
    icon: UploadCloud,
    href: '/msp/assets/imports',
    onClickEvent: 'asset_action_imports'
  },
  {
    id: 'asset-automation',
    label: 'Automation Rules',
    description: 'Configure lifecycle automations & escalations',
    icon: Workflow,
    href: '/msp/assets/automation',
    onClickEvent: 'asset_action_automation'
  },
  {
    id: 'asset-policies',
    label: 'Lifecycle Policies',
    description: 'Apply standardized lifecycle and compliance policies',
    icon: Shield,
    href: '/msp/assets/policies',
    onClickEvent: 'asset_action_policies'
  },
  {
    id: 'asset-integrations',
    label: 'Connector Setup',
    description: 'Manage RMM integrations and discovery connectors',
    icon: FolderGit2,
    href: '/msp/assets/integrations',
    onClickEvent: 'asset_action_integrations'
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
