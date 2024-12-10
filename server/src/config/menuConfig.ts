// server/src/config/sidebarNavigationConfig.ts

import * as RadixIcons from '@radix-ui/react-icons';
import { CreditCard } from 'lucide-react';

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
    href: '/msp/billing'
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
    name: 'Workflows',
    icon: RadixIcons.ArrowRightIcon,
    href: '/msp/workflows'
  }
];

export const bottomMenuItems: MenuItem[] = [
  { 
    name: 'Settings', 
    icon: RadixIcons.GearIcon,
    subItems: [
      { name: 'General', icon: RadixIcons.MixerHorizontalIcon, href: '/msp/settings' },
      {
        name: 'Security',
        href: '/msp/security-settings',
        icon: RadixIcons.LockClosedIcon,
      },
    ]
  },
  { name: 'Support', icon: RadixIcons.QuestionMarkCircledIcon },
];
