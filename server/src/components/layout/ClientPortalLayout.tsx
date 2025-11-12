'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from "next-auth/react";
import { LogOut, User, CreditCard } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useRouter } from 'next/navigation';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { checkClientPortalPermissions } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import { useTranslation } from 'server/src/lib/i18n/client';
import { useBranding } from 'server/src/components/providers/BrandingProvider';
import { getTenantSlugForTenant } from 'server/src/lib/actions/tenant-actions/tenantSlugActions';
import { NotificationBell } from 'server/src/components/notifications/NotificationBell';
import { ActivityDrawerProvider } from 'server/src/components/user-activities/ActivityDrawerProvider';
import { DrawerProvider } from 'server/src/context/DrawerContext';

interface ClientPortalLayoutProps {
  children: ReactNode;
}

export default function ClientPortalLayout({ children }: ClientPortalLayoutProps) {
  const [userData, setUserData] = useState<IUserWithRoles | null>(null);
  const [hasClientSettingsAccess, setHasClientSettingsAccess] = useState(false);
  const [hasBillingAccess, setHasBillingAccess] = useState(false);
  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [hasAccountAccess, setHasAccountAccess] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const { branding } = useBranding();
  

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

  const fetchAvatarUrl = async (contactId: string, tenant: string) => {
    try {
      const contactAvatarUrl = await getContactAvatarUrlAction(contactId, tenant);
      setAvatarUrl(contactAvatarUrl);
    } catch (error) {
      console.error('Error fetching contact avatar:', error);
    }
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

        if (user.contact_id) {
          await fetchAvatarUrl(user.contact_id, user.tenant);
        }
      }
    };

    fetchUserData();
  }, []);

  // Poll for avatar changes every 5 seconds when the component is visible
  useEffect(() => {
    if (!userData?.contact_id || !userData?.tenant) return;

    const intervalId = setInterval(() => {
      fetchAvatarUrl(userData.contact_id!, userData.tenant);
    }, 5000); // Check every 5 seconds

    return () => clearInterval(intervalId);
  }, [userData?.contact_id, userData?.tenant]);

  return (
    <DrawerProvider>
      <ActivityDrawerProvider>
        <div className="min-h-screen bg-gray-100">
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
              </div>
            </div>

            {/* Right side - Notifications and Profile */}
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="flex items-center">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="relative" aria-label="User menu">
                      <ContactAvatar
                        contactId={userData?.contact_id || ''}
                        contactName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                        avatarUrl={avatarUrl}
                        size="sm"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"></span>
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="min-w-[220px] bg-subMenu-bg rounded-md p-1 shadow-md"
                    sideOffset={5}
                    align="end"
                  >
                      <DropdownMenu.Item
                        className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                        onSelect={() => router.push('/client-portal/profile')}
                      >
                        <User className="mr-2 h-3.5 w-3.5" />
                        <span>{t('nav.profile')}</span>
                      </DropdownMenu.Item>
                      {hasAccountAccess && (
                        <DropdownMenu.Item
                          className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                          onSelect={() => router.push('/client-portal/account')}
                        >
                          <CreditCard className="mr-2 h-3.5 w-3.5" />
                          <span>{t('nav.account')}</span>
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item
                        className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                        onSelect={handleSignOut}
                      >
                        <LogOut className="mr-2 h-3.5 w-3.5" />
                        <span>{t('nav.signOut')}</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </div>
          </div>
        </div>
      </nav>

          {/* Main Content */}
          <main className="w-full px-6 py-8">
            {children}
          </main>
        </div>
      </ActivityDrawerProvider>
    </DrawerProvider>
  );
}
