'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getActivePlatformNotifications,
  dismissPlatformNotification,
} from '@enterprise/lib/platformNotifications/actions';

type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

interface PlatformNotification {
  notification_id: string;
  title: string;
  banner_content: string;
  priority: string;
}

function toAlertVariant(priority: string): AlertVariant {
  const valid: AlertVariant[] = ['default', 'destructive', 'success', 'warning', 'info'];
  if (valid.includes(priority as AlertVariant)) return priority as AlertVariant;
  return 'info';
}

export function PlatformNotificationBanner() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);

  useEffect(() => {
    let cancelled = false;

    getActivePlatformNotifications().then((data) => {
      if (!cancelled && Array.isArray(data)) {
        setNotifications(data);
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  if (notifications.length === 0) return null;

  const handleDismiss = async (notificationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.notification_id !== notificationId));
    await dismissPlatformNotification(notificationId);
  };

  return (
    <div className="mx-3 mt-2 flex flex-col gap-2">
      {notifications.map((notification) => (
        <Alert key={notification.notification_id} variant={toAlertVariant(notification.priority)}>
          <AlertDescription>
            <div className="flex items-center gap-3">
              <div
                className="flex-1 text-sm"
                dangerouslySetInnerHTML={{ __html: notification.banner_content }}
              />
              <Link href={`/msp/platform-updates/${notification.notification_id}`} prefetch={false}>
                <Button size="sm" variant="outline" className="text-xs whitespace-nowrap">
                  Learn More
                </Button>
              </Link>
              <button
                onClick={() => handleDismiss(notification.notification_id)}
                className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 flex-shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
