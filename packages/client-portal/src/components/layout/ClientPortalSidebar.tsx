'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Home,
  MessageSquare,
  LayoutTemplate,
  Calendar,
  Monitor,
  BookOpen,
  Layers,
  FileText,
  CreditCard,
  Settings,
  User,
} from 'lucide-react';
import type { ProductCode } from '@alga-psa/types';
import { useBranding } from '@alga-psa/tenancy/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  getPreferenceWithFallback,
  savePreference,
} from '@alga-psa/ui/lib/cookies';
import { ClientPortalExtensionsNav } from './ClientPortalExtensionsNav';

const SIDEBAR_COOKIE_KEY = 'client_portal_sidebar_collapsed';

interface SidebarPermissions {
  hasClientSettingsAccess: boolean;
  hasBillingAccess: boolean;
}

interface SidebarProps {
  productCode?: ProductCode;
  permissions: SidebarPermissions;
  permissionsLoaded: boolean;
  initialCollapsed?: boolean;
}

interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  id: string;
  title?: string;
  items: NavItem[];
}

export function ClientPortalSidebar({
  productCode = 'psa',
  permissions,
  permissionsLoaded,
  initialCollapsed = false,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation('client-portal');
  const { branding } = useBranding();

  // Initialize from server-provided cookie value to avoid hydration flicker.
  const [collapsed, setCollapsedState] = useState<boolean>(initialCollapsed);
  // Disable transitions on first render so the initial paint is instant.
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);

  useEffect(() => {
    // Reconcile with the local-storage fallback in case the cookie is missing
    // (e.g. user upgraded from the previous build that only used localStorage).
    const stored = getPreferenceWithFallback(
      SIDEBAR_COOKIE_KEY,
      String(initialCollapsed),
    );
    const value = stored === 'true';
    if (value !== collapsed) setCollapsedState(value);
    const raf = requestAnimationFrame(() => setTransitionsEnabled(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCollapsed = (next: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      savePreference(SIDEBAR_COOKIE_KEY, String(value));
      return value;
    });
  };

  const sidebarOpen = !collapsed;
  const isAlgadeskPortal = productCode === 'algadesk';

  const workspaceItems: NavItem[] = isAlgadeskPortal
    ? [
        { key: 'dashboard', href: '/client-portal/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: Home },
        { key: 'tickets', href: '/client-portal/tickets', label: t('nav.tickets', 'Tickets'), icon: MessageSquare },
      ]
    : [
        { key: 'dashboard', href: '/client-portal/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: Home },
        { key: 'tickets', href: '/client-portal/tickets', label: t('nav.tickets', 'Tickets'), icon: MessageSquare },
        { key: 'request-services', href: '/client-portal/request-services', label: t('nav.requestServices', 'Request Services'), icon: LayoutTemplate },
        { key: 'projects', href: '/client-portal/projects', label: t('nav.projects', 'Projects'), icon: Layers },
        { key: 'appointments', href: '/client-portal/appointments', label: t('nav.appointments', 'Appointments'), icon: Calendar },
        { key: 'devices', href: '/client-portal/devices', label: t('nav.myDevices', 'My devices'), icon: Monitor },
      ];

  const resourcesItems: NavItem[] = isAlgadeskPortal
    ? [
        {
          key: 'knowledge-base',
          href: '/client-portal/knowledge-base',
          label: t('nav.knowledgeBase', 'Knowledge Base'),
          icon: BookOpen,
        },
      ]
    : [
        { key: 'documents', href: '/client-portal/documents', label: t('nav.documents', 'Documents'), icon: FileText },
        {
          key: 'knowledge-base',
          href: '/client-portal/knowledge-base',
          label: t('nav.knowledgeBase', 'Knowledge Base'),
          icon: BookOpen,
        },
      ];

  const moreItems: NavItem[] = permissionsLoaded
    ? [
        {
          key: 'profile',
          href: '/client-portal/profile',
          label: t('nav.profile', 'Profile'),
          icon: User,
        },
        ...(isAlgadeskPortal
          ? []
          : [
              ...(permissions.hasBillingAccess
                ? [{
                    key: 'billing',
                    href: '/client-portal/billing',
                    label: t('nav.billing'),
                    icon: CreditCard,
                  }]
                : []),
            ]),
        ...(permissions.hasClientSettingsAccess
          ? [{
              key: 'client-settings',
              href: '/client-portal/client-settings',
              label: t('nav.clientSettings'),
              icon: Settings,
            }]
          : []),
      ]
    : [];

  const sections: NavSection[] = [
    { id: 'workspace', title: t('nav.sections.workspace', 'Workspace'), items: workspaceItems },
    { id: 'resources', title: t('nav.sections.resources', 'Resources'), items: resourcesItems },
  ];
  // Only show More section once permissions resolve and at least one item exists,
  // OR show a skeleton placeholder while permissions are loading.
  const showMoreSection =
    !permissionsLoaded || moreItems.length > 0;

  const isActive = (href: string) => {
    if (href === '/client-portal/dashboard') {
      return pathname === href || pathname === '/client-portal';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    const link = (
      <Link
        prefetch={false}
        href={item.href}
        className={[
          'flex items-center px-2 py-2 mx-2 rounded hover:bg-sidebar-hover',
          active ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : '',
        ].join(' ')}
        data-automation-id={`client-sidebar-menu-${item.key}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="h-5 w-5 mr-2 flex-shrink-0" />
        {sidebarOpen && <span className="truncate">{item.label}</span>}
      </Link>
    );

    if (sidebarOpen) {
      return <li key={item.key}>{link}</li>;
    }

    return (
      <Tooltip.Root key={item.key}>
        <Tooltip.Trigger asChild>
          <li>{link}</li>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="bg-subMenu-bg text-subMenu-text px-2 py-1 rounded-md text-sm z-50"
            side="right"
            sideOffset={5}
          >
            {item.label}
            <Tooltip.Arrow style={{ fill: 'var(--color-submenu-bg)' }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  };

  const renderSectionHeader = (section: { title?: string }, idx: number) => {
    if (sidebarOpen && section.title) {
      return (
        <p
          className={`text-xs uppercase tracking-wide text-gray-400 px-2 mb-2 ${
            idx === 0 ? 'mt-0' : 'mt-6'
          }`}
          aria-label={section.title}
        >
          {section.title}
        </p>
      );
    }
    if (section.title) {
      return (
        <div
          className={`h-px bg-gray-700 ${idx === 0 ? 'mt-0 mb-3' : 'my-3'}`}
          aria-hidden
        />
      );
    }
    return null;
  };

  const renderMoreSkeleton = () => {
    if (!sidebarOpen) {
      return (
        <ul className="space-y-1">
          {[0, 1].map((i) => (
            <li key={i} className="px-2 mx-2">
              <Skeleton className="h-9 w-9" />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <ul className="space-y-1">
        {[0, 1].map((i) => (
          <li key={i} className="px-2 py-2 mx-2 flex items-center gap-2">
            <Skeleton className="h-5 w-5 flex-shrink-0" />
            <Skeleton className="h-4 w-24" />
          </li>
        ))}
      </ul>
    );
  };

  const visibleSections = sections.filter((s) => s.items.length > 0);
  const brandLabel = branding?.clientName || (isAlgadeskPortal ? 'Algadesk' : 'AlgaPSA');
  const transitionClass = transitionsEnabled
    ? 'transition-all duration-300 ease-in-out'
    : '';

  return (
    <Tooltip.Provider delayDuration={300}>
      <aside
        data-automation-id="client-portal-sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={`bg-sidebar-bg text-sidebar-text h-screen flex flex-col relative ${transitionClass} ${
          sidebarOpen ? 'w-64' : 'w-16'
        } sticky top-0 flex-shrink-0`}
      >
        {/* Brand */}
        <Link
          prefetch={false}
          href="/client-portal/dashboard"
          className="p-4 flex items-center space-x-2 hover:bg-white/10 cursor-pointer"
          aria-label={t('sidebar.goToDashboard', 'Go to dashboard')}
          id="client-portal-logo-home-link"
        >
          {branding?.logoUrl ? (
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
              {/* Logo URL is arbitrary tenant input; <img> avoids next/image domain allowlist. */}
              <img
                src={branding.logoUrl}
                alt={branding.clientName || 'Client Logo'}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
              <Image
                src="/images/avatar-purple-background.png"
                alt={t('sidebar.logoAlt', 'Client Portal Logo')}
                width={200}
                height={200}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <span className={`text-xl font-semibold truncate ${sidebarOpen ? '' : 'hidden'}`}>
            {brandLabel}
          </span>
        </Link>

        {/* Organization label */}
        {sidebarOpen && branding?.clientName && (
          <div className="px-4 pb-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400">
              {t('nav.organization', 'Organization')}
            </div>
            <div className="mt-0.5 text-sm font-medium truncate">{branding.clientName}</div>
          </div>
        )}

        {/* Nav sections */}
        <nav
          className="mt-2 flex-grow min-h-0 overflow-y-auto overscroll-contain sidebar-nav"
          aria-label={t('nav.clientPortalLabel', 'Client portal')}
        >
          {visibleSections.map((section, idx) => (
            <div key={section.id} className="px-2">
              {renderSectionHeader(section, idx)}
              <ul className="space-y-1">{section.items.map(renderItem)}</ul>
            </div>
          ))}

          {showMoreSection && (
            <div className="px-2">
              {renderSectionHeader(
                { title: t('nav.sections.more', 'More') },
                visibleSections.length,
              )}
              {permissionsLoaded
                ? <ul className="space-y-1">{moreItems.map(renderItem)}</ul>
                : renderMoreSkeleton()}
            </div>
          )}

          {!isAlgadeskPortal && <ClientPortalExtensionsNav sidebarOpen={sidebarOpen} />}
        </nav>

        {/* Collapse toggle */}
        <CollapseToggleButton
          id="client-sidebar-toggle-button"
          isCollapsed={collapsed}
          collapsedLabel={t('sidebar.expandSidebar', 'Expand sidebar')}
          expandedLabel={t('sidebar.collapseSidebar', 'Collapse sidebar')}
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-12 z-10"
        />
      </aside>
    </Tooltip.Provider>
  );
}

export default ClientPortalSidebar;
