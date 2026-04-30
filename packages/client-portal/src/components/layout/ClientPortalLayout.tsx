'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { useContactAvatar } from '@alga-psa/user-composition/hooks';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  checkClientPortalPermissions,
  getSignOutTenantSlug,
} from '@alga-psa/client-portal/actions';
import { useBranding } from '@alga-psa/tenancy/components';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { DrawerProvider, DrawerOutlet } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { ClientPortalSidebar } from './ClientPortalSidebar';
import { ClientPortalTopBar } from './ClientPortalTopBar';
import { ClientPortalUserMenu } from './ClientPortalUserMenu';
import {
  ClientPortalPageProvider,
  useClientPortalHeader,
} from './ClientPortalPageContext';
import { resolveClientPortalTitleKey } from './clientPortalRouteTitles';

interface ClientPortalLayoutProps {
  children: ReactNode;
  initialSidebarCollapsed?: boolean;
}

function LayoutShell({
  children,
  initialSidebarCollapsed,
}: {
  children: ReactNode;
  initialSidebarCollapsed: boolean;
}) {
  const [userData, setUserData] = useState<IUserWithRoles | null>(null);
  const [permissions, setPermissions] = useState({
    hasClientSettingsAccess: false,
    hasBillingAccess: false,
    hasUserManagementAccess: false,
    hasAccountAccess: false,
  });
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const { branding } = useBranding();
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag('knowledge-base', {
    defaultValue: false,
  });
  const { header } = useClientPortalHeader();
  const pathname = usePathname();
  const { t } = useTranslation('client-portal');

  const { avatarUrl } = useContactAvatar(
    userData?.contact_id ?? undefined,
    userData?.tenant,
  );

  const handleSignOut = async () => {
    let callbackUrl = '/auth/client-portal/signin';
    const tenantSlug = await getSignOutTenantSlug();
    if (tenantSlug) {
      callbackUrl = `/auth/client-portal/signin?tenant=${encodeURIComponent(tenantSlug)}`;
    }
    signOut({ callbackUrl });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!mounted) return;
        if (user) {
          setUserData(user);
          const perms = await checkClientPortalPermissions();
          if (!mounted) return;
          setPermissions({
            hasClientSettingsAccess: perms.hasClientSettingsAccess,
            hasBillingAccess: perms.hasBillingAccess,
            hasUserManagementAccess: perms.hasUserManagementAccess,
            hasAccountAccess: perms.hasAccountAccess,
          });
        }
      } finally {
        if (mounted) setPermissionsLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const defaultBreadcrumb = useMemo(() => {
    return branding?.clientName ? branding.clientName.toUpperCase() : '';
  }, [branding?.clientName]);

  const defaultTitle = useMemo(() => {
    const key = resolveClientPortalTitleKey(pathname);
    return key ? t(key) : '';
  }, [pathname, t]);

  return (
    <div className="flex min-h-screen bg-gray-100">
      <ClientPortalSidebar
        permissions={{
          hasClientSettingsAccess: permissions.hasClientSettingsAccess,
          hasBillingAccess: permissions.hasBillingAccess,
        }}
        permissionsLoaded={permissionsLoaded}
        knowledgeBaseEnabled={knowledgeBaseEnabled}
        initialCollapsed={initialSidebarCollapsed}
      />

      <div className="flex min-h-screen flex-1 flex-col min-w-0">
        <ClientPortalTopBar
          breadcrumb={header.breadcrumb ?? defaultBreadcrumb}
          title={header.title ?? defaultTitle}
          primaryAction={header.primaryAction}
          userMenu={
            <ClientPortalUserMenu
              userData={userData}
              avatarUrl={avatarUrl}
              hasAccountAccess={permissions.hasAccountAccess}
              onSignOut={handleSignOut}
            />
          }
        />
        <main className="flex-1 w-full px-6 py-6 flex flex-col min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function ClientPortalLayout({
  children,
  initialSidebarCollapsed = false,
}: ClientPortalLayoutProps) {
  return (
    <DrawerProvider>
      <ClientPortalPageProvider>
        <LayoutShell initialSidebarCollapsed={initialSidebarCollapsed}>
          {children}
        </LayoutShell>
      </ClientPortalPageProvider>
      <DrawerOutlet />
    </DrawerProvider>
  );
}
