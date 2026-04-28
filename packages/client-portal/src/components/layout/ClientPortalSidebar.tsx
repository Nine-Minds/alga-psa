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
} from 'lucide-react';
import { useBranding } from '@alga-psa/tenancy/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { ClientPortalExtensionsNav } from './ClientPortalExtensionsNav';

const STORAGE_KEY = 'clientPortalSidebarOpen';

interface SidebarPermissions {
  hasClientSettingsAccess: boolean;
  hasBillingAccess: boolean;
}

interface SidebarProps {
  permissions: SidebarPermissions;
  knowledgeBaseEnabled: boolean;
}

interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  show?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

export function ClientPortalSidebar({
  permissions,
  knowledgeBaseEnabled,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation('client-portal');
  const { branding } = useBranding();

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (saved !== null) setSidebarOpen(saved === 'true');
    } catch {
      /* no-op */
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(sidebarOpen));
    } catch {
      /* no-op */
    }
  }, [sidebarOpen, mounted]);

  const workspaceSection: NavSection = {
    title: t('nav.sections.workspace', 'Workspace'),
    items: [
      { key: 'dashboard', href: '/client-portal/dashboard', label: t('nav.dashboard', 'Dashboard'), icon: Home },
      { key: 'tickets', href: '/client-portal/tickets', label: t('nav.tickets', 'Tickets'), icon: MessageSquare },
      { key: 'request-services', href: '/client-portal/request-services', label: t('nav.requestServices', 'Request Services'), icon: LayoutTemplate },
      { key: 'projects', href: '/client-portal/projects', label: t('nav.projects', 'Projects'), icon: Layers },
      { key: 'appointments', href: '/client-portal/appointments', label: t('nav.appointments', 'Appointments'), icon: Calendar },
      { key: 'devices', href: '/client-portal/devices', label: t('nav.myDevices', 'My devices'), icon: Monitor },
    ],
  };

  const resourcesSection: NavSection = {
    title: t('nav.sections.resources', 'Resources'),
    items: [
      { key: 'documents', href: '/client-portal/documents', label: t('nav.documents', 'Documents'), icon: FileText },
      {
        key: 'help',
        href: '/client-portal/knowledge-base',
        label: t('nav.helpCenter', 'Help center'),
        icon: BookOpen,
        show: knowledgeBaseEnabled,
      },
    ],
  };

  const moreSection: NavSection = {
    title: t('nav.sections.more', 'More'),
    items: [
      {
        key: 'billing',
        href: '/client-portal/billing',
        label: t('nav.billing'),
        icon: CreditCard,
        show: permissions.hasBillingAccess,
      },
      {
        key: 'client-settings',
        href: '/client-portal/client-settings',
        label: t('nav.clientSettings'),
        icon: Settings,
        show: permissions.hasClientSettingsAccess,
      },
    ],
  };

  const isActive = (href: string) => {
    if (href === '/client-portal/dashboard') {
      return pathname === href || pathname === '/client-portal';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const visibleSections = [workspaceSection, resourcesSection, moreSection]
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show !== false) }))
    .filter((s) => s.items.length > 0);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    const content = (
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
      return <li key={item.key}>{content}</li>;
    }

    return (
      <Tooltip.Provider delayDuration={300} key={item.key}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <li>{content}</li>
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
      </Tooltip.Provider>
    );
  };

  const brandLabel = branding?.clientName || 'AlgaPSA';

  return (
    <aside
      data-automation-id="client-portal-sidebar"
      className={`bg-sidebar-bg text-sidebar-text h-screen flex flex-col relative transition-all duration-300 ease-in-out ${
        sidebarOpen ? 'w-64' : 'w-16'
      } sticky top-0 flex-shrink-0`}
      style={{ width: sidebarOpen ? '16rem' : '4rem' }}
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

      {/* Organization label (visible when expanded) */}
      {sidebarOpen && branding?.clientName && (
        <div className="px-4 pb-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            {t('nav.organization', 'Organization')}
          </div>
          <div className="mt-0.5 text-sm font-medium truncate">{branding.clientName}</div>
        </div>
      )}

      {/* Nav sections */}
      <nav className="mt-2 flex-grow min-h-0 overflow-y-auto overscroll-contain sidebar-nav">
        {visibleSections.map((section, idx) => (
          <div key={section.title || `section-${idx}`} className="px-2">
            {sidebarOpen && section.title ? (
              <p
                className={`text-xs uppercase tracking-wide text-gray-400 px-2 mb-2 ${
                  idx === 0 ? 'mt-0' : 'mt-6'
                }`}
                aria-label={section.title}
              >
                {section.title}
              </p>
            ) : section.title ? (
              <div
                className={`h-px bg-gray-700 ${idx === 0 ? 'mt-0 mb-3' : 'my-3'}`}
                aria-hidden
              />
            ) : null}
            <ul className="space-y-1">{section.items.map(renderItem)}</ul>
          </div>
        ))}

        <ClientPortalExtensionsNav sidebarOpen={sidebarOpen} />
      </nav>


      {/* Collapse toggle */}
      <CollapseToggleButton
        id="client-sidebar-toggle-button"
        isCollapsed={!sidebarOpen}
        collapsedLabel={t('sidebar.expandSidebar', 'Expand sidebar')}
        expandedLabel={t('sidebar.collapseSidebar', 'Collapse sidebar')}
        onClick={() => setSidebarOpen((v) => !v)}
        className="absolute -right-3 top-12 z-10"
      />
    </aside>
  );
}

export default ClientPortalSidebar;
