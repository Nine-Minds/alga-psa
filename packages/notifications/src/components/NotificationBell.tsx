'use client';


import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { NotificationDropdown } from './NotificationDropdown';
import { useSession } from 'next-auth/react';
import { useInternalNotifications } from '../hooks/useInternalNotifications';

interface NotificationBellProps {
  className?: string;
}

function NotificationBellInner({ tenant, userId, className = '' }: { tenant: string; userId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('client-portal');

  // Use the internal notifications hook
  const {
    notifications,
    unreadCount,
    highUnreadCount,
    isConnected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh
  } = useInternalNotifications({
    tenant,
    userId,
    limit: 20,
    enablePolling: true
  });

  // The badge counts unread *high* only (attention-red); when no high items are
  // unread but normal/low unread exist, a subtle neutral dot renders instead of
  // a number.
  const showHighBadge = highUnreadCount > 0;
  const showNeutralDot = highUnreadCount === 0 && unreadCount > 0;
  const ariaUnread = highUnreadCount;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button
          id="notification-bell"
          variant="ghost"
          size="icon"
          className={`relative h-9 w-9 ${className}`}
          aria-label={
            ariaUnread > 0
              ? t('notifications.bellUnreadAria', 'Notifications ({{unread}} unread)', { unread: ariaUnread })
              : t('notifications.title', 'Notifications')
          }
        >
          <Bell className="w-5 h-5" />
          {showHighBadge && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold text-white bg-rose-600 rounded-full border-2 border-[rgb(var(--color-card))]">
              {highUnreadCount > 99 ? '99+' : highUnreadCount}
            </span>
          )}
          {showNeutralDot && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[rgb(var(--color-text-400))] rounded-full border border-[rgb(var(--color-card))]" title={t('notifications.unreadDot', 'Unread notifications')} />
          )}
          {!isConnected && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full border border-[rgb(var(--color-card))]" title={t('notifications.reconnecting', 'Reconnecting...')} />
          )}
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="w-[420px] bg-[rgb(var(--color-card))] rounded-lg shadow-lg border border-[rgb(var(--color-border-200))] z-50"
          sideOffset={8}
          align="end"
        >
          <NotificationDropdown
            notifications={notifications}
            unreadCount={unreadCount}
            isLoading={isLoading}
            error={error}
            isConnected={isConnected}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onRefresh={refresh}
            onClose={() => setOpen(false)}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function NotificationBell({ className = '' }: NotificationBellProps) {
  const { data: session } = useSession();

  // Get tenant and userId from session
  const tenant = session?.user?.tenant;
  const userId = session?.user?.id; // Changed from user_id to id

  // Don't render if no tenant or user
  if (!tenant || !userId) {
    return null;
  }

  return <NotificationBellInner tenant={tenant} userId={userId} className={className} />;
}
