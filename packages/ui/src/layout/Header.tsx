'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ChevronRight,
  Home,
  PlusCircle,
  Settings,
  User,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { NotificationBell } from '@alga-psa/ui/components/notifications/NotificationBell';
import type { IUserWithRoles } from '@alga-psa/types';
import { menuItems, bottomMenuItems, MenuItem } from '../config/menuConfig';
import { getCurrentUser } from '@alga-psa/users/actions';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import type { JobMetrics } from '@alga-psa/jobs/actions';
import { getQueueMetricsAction } from '@alga-psa/jobs/actions';
import { analytics } from '@alga-psa/analytics/client';
import { QuickCreateDialog, QuickCreateType } from './QuickCreateDialog';

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

interface QuickCreateOption {
  id: string;
  label: string;
  description: string;
  type: QuickCreateType;
}

const quickCreateOptions: QuickCreateOption[] = [
  {
    id: 'create-ticket',
    label: 'Ticket',
    description: 'Create a new support ticket',
    type: 'ticket'
  },
  {
    id: 'create-client',
    label: 'Client',
    description: 'Add a new client to your system',
    type: 'client'
  },
  {
    id: 'create-contact',
    label: 'Contact',
    description: 'Add a new contact person',
    type: 'contact'
  },
  {
    id: 'create-project',
    label: 'Project',
    description: 'Start a new project',
    type: 'project'
  },
  {
    id: 'create-asset',
    label: 'Asset',
    description: 'Add a new device to your workspace',
    type: 'asset'
  },
  {
    id: 'create-service',
    label: 'Service',
    description: 'Add a new billable service',
    type: 'service'
  },
  {
    id: 'create-product',
    label: 'Product',
    description: 'Add a new product to your catalog',
    type: 'product'
  }
];

const getMenuItemNameByPath = (path: string | null | undefined): string => {
  if (!path) return 'Dashboard';

  const allMenuItems = [...menuItems, ...bottomMenuItems];

  const segments = path.split('/');
  const topLevelPath = segments.length > 1 ? '/' + segments[1] : '/';

  const findMenuItem = (items: MenuItem[]): string | null => {
    for (const item of items) {
      if (item.href === topLevelPath || (item.href && path.startsWith(item.href))) {
        return item.name;
      }
      if (item.subItems) {
        const subItemName = findMenuItem(item.subItems);
        if (subItemName) return subItemName;
      }
    }
    return null;
  };

  return findMenuItem(allMenuItems) || 'Dashboard';
};

const TenantBadge: React.FC<{ tenant?: string | null }> = ({ tenant }) => {
  if (!tenant) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 border border-slate-200"
      aria-label={`Active tenant ${tenant}`}
    >
      {tenant}
    </span>
  );
};

const QuickCreateMenu: React.FC = () => {
  const [activeQuickCreate, setActiveQuickCreate] = useState<QuickCreateType>(null);

  const handleQuickCreateSelect = (type: QuickCreateType) => {
    analytics.capture('ui.quick_create.select', { target: type });
    setActiveQuickCreate(type);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id="global-quick-create-trigger"
            variant="ghost"
            size="sm"
            className="flex items-center gap-2"
            aria-label="Open quick create"
          >
            <PlusCircle className="h-5 w-5" />
            <span className="hidden lg:inline text-sm font-medium">Quick Create</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Create</p>
          </div>
          {quickCreateOptions.map((option) => (
            <DropdownMenuItem
              key={option.id}
              id={`${option.id}-menu-item`}
              onSelect={() => handleQuickCreateSelect(option.type)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="text-sm font-medium text-gray-900">{option.label}</span>
              <span className="text-xs text-gray-500">{option.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      
      {activeQuickCreate && (
        <QuickCreateDialog
          type={activeQuickCreate}
          onClose={() => setActiveQuickCreate(null)}
        />
      )}
    </>
  );
};

// NotificationMenu component removed - replaced with NotificationBell

const JobActivityIndicator: React.FC = () => {
  const router = useRouter();
  const [metrics, setMetrics] = useState<JobMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const data = await getQueueMetricsAction();
        if (isMounted) {
          setMetrics(data);
        }
      } catch (error) {
        console.error('[Header] Failed to fetch job metrics', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchMetrics();
    interval = setInterval(fetchMetrics, 15000);

    return () => {
      isMounted = false;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);

  const activeJobs = metrics?.active ?? 0;
  const failedJobs = metrics?.failed ?? 0;
  const hasAttention = failedJobs > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id="job-activity-trigger"
          variant="ghost"
          size="icon"
          aria-label="View background job activity"
          className="relative h-9 w-9"
        >
          <Activity className={`h-5 w-5 ${hasAttention ? 'text-amber-600' : 'text-gray-600'}`} />
          {(activeJobs > 0 || failedJobs > 0) && (
            <span className={`absolute right-1 top-1 inline-flex h-2.5 w-2.5 rounded-full ${failedJobs > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-3 py-2">
          <p className="text-sm font-semibold text-gray-900">Background Jobs</p>
          <p className="text-xs text-gray-500">Track imports, automation runs, and scheduled work.</p>
        </div>
        <DropdownMenuSeparator />
        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Active jobs</span>
            <span className="font-medium text-gray-900">{loading ? '—' : activeJobs}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Queued jobs</span>
            <span className="font-medium text-gray-900">{loading ? '—' : metrics?.queued ?? 0}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Failed last 24h</span>
            <span className={`font-medium ${failedJobs > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{loading ? '—' : failedJobs}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          id="open-job-center-menu-item"
          onSelect={() => {
            analytics.capture('ui.job_center.opened');
            router.push('/msp/jobs');
          }}
        >
          Open Job Center
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default function Header({
  sidebarOpen,
  setSidebarOpen,
  rightSidebarOpen: _rightSidebarOpen,
  setRightSidebarOpen: _setRightSidebarOpen,
}: HeaderProps) {
  const [userData, setUserData] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [canManageAccount, setCanManageAccount] = useState<boolean>(false);
  const router = useRouter();

  useEffect(() => {
    const fetchUserData = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserData(user);
        // getCurrentUser already includes avatarUrl
        setAvatarUrl(user.avatarUrl ?? null);

        const hasAccountPermission = await checkAccountManagementPermission();
        setCanManageAccount(hasAccountPermission);
      }
    };

    fetchUserData();
  }, []);

  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin', redirect: true });
  };

  const getBreadcrumbItems = (path: string | null | undefined): { name: string; href: string }[] => {
    const breadcrumbs = [
      {
        name: 'Home',
        href: '/'
      }
    ];

    if (path && path !== '/') {
      const menuName = getMenuItemNameByPath(path);
      breadcrumbs.push({
        name: menuName,
        href: '#'
      });
    }

    return breadcrumbs;
  };

  const pathname = usePathname();
  const breadcrumbItems = useMemo(() => getBreadcrumbItems(pathname), [pathname]);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2">
            {breadcrumbItems.map((item, index) => (
              <li key={`${item.href}-${index}`} className="flex items-center">
                {index > 0 && (
                  <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
                )}
                {index === 0 ? (
                  <Link
                    prefetch={false}
                    href={item.href}
                    className="text-gray-500 hover:text-main-800 text-md transition-colors cursor-pointer"
                    aria-label="Home"
                  >
                    <Home className="w-5 h-5" />
                  </Link>
                ) : index === breadcrumbItems.length - 1 ? (
                  <span className="text-xl font-semibold text-main-800">
                    {item.name}
                  </span>
                ) : (
                  <Link
                    prefetch={false}
                    href={item.href}
                    className="text-md text-gray-500 hover:text-main-800 transition-colors cursor-pointer"
                  >
                    {item.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <TenantBadge tenant={userData?.tenant} />
        <QuickCreateMenu />
        <NotificationBell />
        <JobActivityIndicator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="user-menu-trigger"
              variant="ghost"
              size="icon"
              aria-label="Open user menu"
              className="relative h-10 w-10 rounded-full"
            >
              {userData?.user_type === 'client' ? (
                <ContactAvatar
                  contactId={userData?.contact_id || ''}
                  contactName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                  avatarUrl={avatarUrl}
                  size="sm"
                />
              ) : (
                <UserAvatar
                  userId={userData?.user_id || ''}
                  userName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                  avatarUrl={avatarUrl}
                  size="sm"
                />
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="min-w-[220px]">
            <div className="px-3 py-2">
              <p className="text-sm font-semibold text-gray-900">
                {userData ? `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() : 'User'}
              </p>
              <p className="text-xs text-gray-500">Quick access to profile & account.</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id="user-profile-menu-item"
              onSelect={() => router.push(userData?.user_type === 'client' ? '/client/profile' : '/msp/profile')}
            >
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            {canManageAccount && (
              <DropdownMenuItem
                id="user-account-menu-item"
                onSelect={() => router.push('/msp/account')}
              >
                <Settings className="mr-2 h-4 w-4" />
                Account
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id="user-sign-out-menu-item"
              onSelect={handleSignOut}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
