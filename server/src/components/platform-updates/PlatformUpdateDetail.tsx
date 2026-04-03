'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { recordPlatformNotificationDetailView } from '@enterprise/lib/platformNotifications/actions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PlatformUpdateDetailProps {
  notificationId: string;
  title: string;
  detailContent: string;
  variant: string;
  createdAt: string;
}

type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

function toAlertVariant(v: string): AlertVariant {
  const valid: AlertVariant[] = ['default', 'destructive', 'success', 'warning', 'info'];
  if (valid.includes(v as AlertVariant)) return v as AlertVariant;
  return 'info';
}

export function PlatformUpdateDetail({
  notificationId,
  title,
  detailContent,
  variant: variantProp,
  createdAt,
}: PlatformUpdateDetailProps) {
  const router = useRouter();
  const { t } = useTranslation('msp/profile');
  const { formatDate } = useFormatters();
  const viewRecorded = useRef(false);
  const variant = toAlertVariant(variantProp);
  const label = t(`platformUpdates.detail.labels.${variantProp}`, {
    defaultValue: t('platformUpdates.detail.labels.default', { defaultValue: 'Notice' }),
  });

  // Record detail view on client mount — avoids overcounting from prefetch/RSC renders
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    recordPlatformNotificationDetailView(notificationId).catch(() => {});
  }, [notificationId]);

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <Button
        id="platform-update-back"
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        {t('platformUpdates.detail.back', { defaultValue: 'Back' })}
      </Button>

      <div className="bg-[rgb(var(--color-card))] rounded-lg border border-[rgb(var(--color-border-200))] p-6">
        <Alert variant={variant} className="mb-4">
          <AlertDescription>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-[rgb(var(--color-text-400))]">
                {formatDate(createdAt)}
              </span>
            </div>
          </AlertDescription>
        </Alert>

        <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))] mb-4">
          {title}
        </h1>

        <div
          className="prose prose-sm dark:prose-invert max-w-none text-[rgb(var(--color-text-700))]"
          dangerouslySetInnerHTML={{ __html: detailContent }}
        />
      </div>
    </div>
  );
}
