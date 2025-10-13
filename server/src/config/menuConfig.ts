// server/src/config/sidebarNavigationConfig.ts

import {
  BarChart3,
  MessageSquare,
  Layers,
  Building2,
  Users,
  FileText,
  Timer,
  Clock,
  CreditCard,
  CheckCircle,
  Calendar,
  LayoutDashboard,
  MapPin,
  Rocket,
  Layout,
  Code,
  Bell,
  Monitor,
  Home,
  Settings,
  UserCircle,
  Shield,
  HelpCircle,
  SlidersHorizontal,
  Search,
  GitBranch
} from 'lucide-react';
import { billingTabDefinitions } from '../components/billing-dashboard/billingTabsConfig';

export interface MenuItem {
  name: string;
  icon: React.ElementType;
  href?: string;
  subItems?: MenuItem[];
}

export const menuItems: MenuItem[] = [
  {
    name: 'Home',
    icon: Home,
    href: '/msp/dashboard'  // Updated to point to our new dashboard page
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
    name: 'Projects',
    icon: Layers,
    href: '/msp/projects'
  },
  // {
  //   name: 'Assets',
  //   icon: Monitor,
  //   href: '/msp/assets'
  // },
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
    name: 'Time Management',
    icon: Timer,
    subItems: [
      { name: 'Time Entry', icon: Clock, href: '/msp/time-entry' },
      { name: 'Time Sheet Approvals', icon: CheckCircle, href: '/msp/time-sheet-approvals' },
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
        icon: Code,
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
    name: 'System',
    icon: Monitor,
    subItems: [
      {
        name: 'Job Monitoring',
        icon: LayoutDashboard,
        href: '/msp/jobs'
      }
    ]
  }
];

export const bottomMenuItems: MenuItem[] = [
  {
    name: 'Settings',
    icon: Settings,
    subItems: [
      { name: 'General', icon: SlidersHorizontal, href: '/msp/settings' },
      { name: 'Profile', icon: UserCircle, href: '/msp/profile' },
      {
        name: 'Security',
        href: '/msp/security-settings',
        icon: Shield,
      },
    ]
  },
  { name: 'Support', icon: HelpCircle, href: 'https://www.nineminds.com/support' },
];
