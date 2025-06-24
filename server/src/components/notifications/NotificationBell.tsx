'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { useNotifications } from 'server/src/lib/hooks/useNotifications';
import { NotificationList } from './NotificationList';

export function NotificationBell() {
  const { notifications, unreadCount, connectionState } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id="notification-bell"
          variant="ghost"
          size="icon"
          className="relative p-2 h-10 w-10"
          data-automation-id="notification-bell"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="error" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
          {connectionState === 'connecting' && (
            <div className="absolute -bottom-1 -right-1 h-2 w-2 bg-yellow-500 rounded-full animate-pulse" />
          )}
          {connectionState === 'open' && (
            <div className="absolute -bottom-1 -right-1 h-2 w-2 bg-green-500 rounded-full" />
          )}
          {connectionState === 'closed' && (
            <div className="absolute -bottom-1 -right-1 h-2 w-2 bg-red-500 rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 p-0" align="end">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Notifications</h4>
            <div className="flex items-center gap-2">
              {connectionState === 'open' && (
                <div className="flex items-center gap-1 text-xs text-green-600">
                  <div className="h-2 w-2 bg-green-500 rounded-full" />
                  Live
                </div>
              )}
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {unreadCount} new
                </Badge>
              )}
            </div>
          </div>
        </div>
        <NotificationList 
          notifications={notifications} 
          onClose={() => setIsOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}