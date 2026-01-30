'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from "next-auth/react";
import { LogOut, User, CreditCard } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@alga-psa/ui/components/DropdownMenu';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { getCurrentUser } from '@alga-psa/users/actions';
import { useContactAvatar } from '@alga-psa/users/hooks';
import type { IUserWithRoles } from '@alga-psa/types';
import { useRouter } from 'next/navigation';
import { checkClientPortalPermissions } from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useBranding } from '@alga-psa/tenancy/components';
import { getTenantSlugForTenant } from '@alga-psa/tenancy/actions';
import { ClientExtensionsMenu } from '@alga-psa/client-portal/components';
import { NotificationBell } from '@alga-psa/notifications/components';
import { ActivityDrawerProvider } from '@alga-psa/workflows/components';
import { DrawerProvider } from '@alga-psa/ui';

interface ClientPortalLayoutProps {
  children: ReactNode;
}

export default function ClientPortalLayout({ children }: ClientPortalLayoutProps) {
  const [userData, setUserData] = useState<IUserWithRoles | null>(null);
  const [hasClientSettingsAccess, setHasClientSettingsAccess] = useState(false);
  const [hasBillingAccess, setHasBillingAccess] = useState(false);
  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [hasAccountAccess, setHasAccountAccess] = useState(false);
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const { branding } = useBranding();

  // Use SWR hook for contact avatar - automatically updates when invalidated
  const { avatarUrl } = useContactAvatar(userData?.contact_id ?? undefined, userData?.tenant);

  const handleSignOut = async () => {
    // Get tenant slug to include in callback URL
    let callbackUrl = '/auth/client-portal/signin';
    if (userData?.tenant) {
      try {
        const tenantSlug = await getTenantSlugForTenant(userData.tenant);
        callbackUrl = `/auth/client-portal/signin?tenant=${encodeURIComponent(tenantSlug)}`;
      } catch (error) {
        console.error('Error getting tenant slug for sign out:', error);
        // Fallback to signin page without tenant
      }
    }

    signOut({ callbackUrl });
    console.log('Signing out...');
  };

  useEffect(() => {
    const fetchUserData = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserData(user);

        // Check permissions using the server action
        const permissions = await checkClientPortalPermissions();
        setHasClientSettingsAccess(permissions.hasClientSettingsAccess);
        setHasBillingAccess(permissions.hasBillingAccess);
        setHasUserManagementAccess(permissions.hasUserManagementAccess);
        setHasAccountAccess(permissions.hasAccountAccess);
      }
    };

    fetchUserData();
  }, []);

  return (
    <DrawerProvider>
      <ActivityDrawerProvider>
        <div className="min-h-screen bg-gray-100 flex flex-col">
        {/* Navigation Bar */}
        <nav className="bg-transparent shadow-[0_5px_10px_rgba(0,0,0,0.1)]">
        <div className="w-full px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Left side - Logo and Navigation */}
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Link href="/client-portal/dashboard" className="flex items-center gap-2">
                  {branding?.logoUrl ? (
                    <>
                      {console.log('ClientPortalLayout: Rendering logo with URL:', branding.logoUrl)}
                      <img
                        src={branding.logoUrl}
                        alt={branding.clientName || 'Client Logo'}
                        className="h-8 object-contain"
                      />
                    </>
                  ) : (
                    <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
                      <Image
                        src="/images/avatar-purple-background.png"
                        alt="AlgaPSA Logo"
                        width={200}
                        height={200}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <span className="text-lg font-semibold flex items-center">
                    <span className="text-[rgb(var(--color-text-900))]">
                      {branding?.clientName ? `${branding.clientName} ${t('nav.portal')}` : t('nav.clientPortal')}
                    </span>
                  </span>
                </Link>
              </div>
              <div className="ml-10 flex items-baseline space-x-4">
                <Link
                  href="/client-portal/dashboard"
                  className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-primary-500))]"
                >
                  {t('nav.dashboard')}
                </Link>
                <Link
                  href="/client-portal/tickets"
                  className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                >
                  {t('nav.tickets')}
                </Link>
                <Link
                  href="/client-portal/projects"
                  className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                >
                  {t('nav.projects')}
                </Link>
                <Link
                  href="/client-portal/appointments"
                  className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                >
                  {t('nav.appointments')}
                </Link>
                {hasBillingAccess && (
                  <Link
                    href="/client-portal/billing"
                    className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                  >
                    {t('nav.billing')}
                  </Link>
                )}
                {/*
                <Link
                  href="/client-portal/assets"
                  className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                >
                  Assets
                </Link>
                */}
                {hasClientSettingsAccess && (
                  <Link 
                    href="/client-portal/client-settings" 
                    className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))]"
                  >
                    {t('nav.clientSettings')}
                  </Link>
                )}
                <ClientExtensionsMenu />
              </div>
            </div>

            {/* Right side - Notifications and Profile */}
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="flex items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="relative" aria-label="User menu">
                      <ContactAvatar
                        contactId={userData?.contact_id || ''}
                        contactName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                        avatarUrl={avatarUrl}
                        size="sm"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"></span>
                    </button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    <DropdownMenuItem
                      id="client-profile-menu-item"
                      onSelect={() => router.push('/client-portal/profile')}
                    >
                      <User className="mr-2 h-4 w-4" />
                      {t('nav.profile')}
                    </DropdownMenuItem>
                    {hasAccountAccess && (
                      <DropdownMenuItem
                        id="client-account-menu-item"
                        onSelect={() => router.push('/client-portal/account')}
                      >
                        <CreditCard className="mr-2 h-4 w-4" />
                        {t('nav.account')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      id="client-sign-out-menu-item"
                      onSelect={handleSignOut}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      {t('nav.signOut')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </nav>

          {/* Main Content */}
          <main className="flex-1 w-full px-6 py-8 flex flex-col min-h-0">
            {children}
          </main>
        </div>
      </ActivityDrawerProvider>
    </DrawerProvider>
  );
}
