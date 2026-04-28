'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User, CreditCard } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IUserWithRoles } from '@alga-psa/types';

interface ClientPortalUserMenuProps {
  userData: IUserWithRoles | null;
  avatarUrl: string | null | undefined;
  hasAccountAccess: boolean;
  onSignOut: () => void;
}

export function ClientPortalUserMenu({
  userData,
  avatarUrl,
  hasAccountAccess,
  onSignOut,
}: ClientPortalUserMenuProps) {
  const router = useRouter();
  const { t } = useTranslation('client-portal');

  const displayName =
    `${userData?.first_name ?? ''} ${userData?.last_name ?? ''}`.trim() ||
    userData?.email ||
    '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex items-center rounded-full focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-300))]"
          aria-label="User menu"
          data-automation-id="client-portal-user-menu"
        >
          <ContactAvatar
            contactId={userData?.contact_id || ''}
            contactName={displayName || 'User'}
            avatarUrl={avatarUrl ?? null}
            size="sm"
          />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {displayName && (
          <div className="border-b border-[rgb(var(--color-border-100))] px-3 py-2">
            <div className="text-sm font-medium text-[rgb(var(--color-text-900))] truncate">
              {displayName}
            </div>
            {userData?.email && (
              <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
                {userData.email}
              </div>
            )}
          </div>
        )}
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
        <DropdownMenuItem id="client-sign-out-menu-item" onSelect={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          {t('nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ClientPortalUserMenu;
