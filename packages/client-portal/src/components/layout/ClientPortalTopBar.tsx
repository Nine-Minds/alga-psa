'use client';

import { ReactNode } from 'react';
import { NotificationBell } from '@alga-psa/notifications/components';
import { ThemeToggle } from '@alga-psa/ui/components/ThemeToggle';

interface TopBarProps {
  breadcrumb?: ReactNode;
  title?: string;
  primaryAction?: ReactNode;
  userMenu?: ReactNode;
}

export function ClientPortalTopBar({
  breadcrumb,
  title,
  primaryAction,
  userMenu,
}: TopBarProps) {
  return (
    <header className="w-full border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          {breadcrumb && (
            <div className="text-[11px] uppercase tracking-wider text-[rgb(var(--color-text-500))] truncate">
              {breadcrumb}
            </div>
          )}
          {title && (
            <h1 className="mt-0.5 text-xl font-semibold text-[rgb(var(--color-text-900))] truncate">
              {title}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <NotificationBell />
          <ThemeToggle />
          {primaryAction && <div className="ml-1">{primaryAction}</div>}
          {userMenu && <div className="ml-2">{userMenu}</div>}
        </div>
      </div>
    </header>
  );
}

export default ClientPortalTopBar;
