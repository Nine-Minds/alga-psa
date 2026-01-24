'use client';


import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { NotificationDropdown } from './NotificationDropdown';
import { useSession } from 'next-auth/react';
import { useInternalNotifications } from '../hooks/useInternalNotifications';

interface NotificationBellProps {
  className?: string;
}

function NotificationBellInner({ tenant, userId, className = '' }: { tenant: string; userId: string; className?: string }) {
  const [open, setOpen] = useState(false);

  // Use the internal notifications hook
  const {
    notifications,
    unreadCount,
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

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          id="notification-bell"
          className={`relative p-2 text-gray-600 hover:text-main-800 transition-colors ${className}`}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold text-white bg-red-500 rounded-full border-2 border-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {!isConnected && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full border border-white" title="Reconnecting..." />
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="w-[420px] bg-white rounded-lg shadow-lg border border-gray-200 z-50"
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
