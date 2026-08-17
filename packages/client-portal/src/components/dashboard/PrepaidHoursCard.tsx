'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Clock, ArrowRight } from 'lucide-react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  checkClientPortalPermissions,
  getClientBucketUsage,
  getClientHourBlocks,
  type ClientBucketUsageResult,
  type ClientPortalHourBlock,
} from '@alga-psa/client-portal/actions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  getRemainingMinutes,
  getBucketMeterColors,
  formatBucketHours,
} from '../billing/bucketUsageMeter';

/**
 * "Prepaid hours" dashboard widget: one mini remaining-hours meter per bucket
 * line, plus one row per prepaid hour block. Renders nothing unless the release
 * flag is on, the portal user has billing access, and there is at least one
 * bucket line or hour block. A permission error from the actions also counts
 * as "render nothing".
 */
export function PrepaidHoursCard() {
  const { t } = useTranslation('features/billing');
  const { enabled: widgetEnabled } = useFeatureFlag('release-v1.5-feature', {
    defaultValue: false,
  });
  const [buckets, setBuckets] = useState<ClientBucketUsageResult[] | null>(null);
  const [hourBlocks, setHourBlocks] = useState<ClientPortalHourBlock[]>([]);

  useEffect(() => {
    if (!widgetEnabled) {
      setBuckets(null);
      setHourBlocks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const permissions = await checkClientPortalPermissions();
        if (cancelled) return;
        if (!permissions.hasBillingAccess) {
          setBuckets([]);
          return;
        }
        const [bucketResult, blockResult] = await Promise.all([
          getClientBucketUsage(),
          getClientHourBlocks(),
        ]);
        if (cancelled) return;
        if (isActionMessageError(bucketResult) || isActionPermissionError(bucketResult)) {
          setBuckets([]);
        } else {
          setBuckets(bucketResult);
        }
        if (!isActionMessageError(blockResult) && !isActionPermissionError(blockResult)) {
          setHourBlocks(blockResult);
        }
      } catch (error) {
        console.error('Error loading prepaid hours widget:', error);
        if (!cancelled) setBuckets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetEnabled]);

  if (!widgetEnabled || !buckets || (buckets.length === 0 && hourBlocks.length === 0)) {
    return null;
  }

  return (
    <Card id="prepaid-hours-card" className="bg-[rgb(var(--color-card))]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
            <CardTitle>{t('dashboard.prepaidHours', 'Prepaid hours')}</CardTitle>
          </div>
          <Link
            href="/client-portal/billing"
            className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))]"
          >
            {t('dashboard.viewBilling', 'View billing')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {buckets.map((bucket, index) => {
            const remainingMinutes = getRemainingMinutes(bucket);
            const totalWithRollover = bucket.total_minutes + bucket.rolled_over_minutes;
            const remainingHours = remainingMinutes / 60;
            const isOver = remainingMinutes < 0;
            const overHours = isOver ? -remainingHours : 0;
            const meterColors = getBucketMeterColors(remainingMinutes, totalWithRollover);
            const fillPercent = Math.max(0, Math.min(100, bucket.percentage_used));

            return (
              <li
                key={`${bucket.contract_line_id}-${bucket.service_id}-${index}`}
                className="rounded-md border border-[rgb(var(--color-border-100))] p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
                    {bucket.display_label}
                  </span>
                  {isOver ? (
                    <Badge variant="error" size="sm" className="shrink-0">
                      {t('bucket.overHours', {
                        hours: formatBucketHours(overHours),
                        defaultValue: '{{hours}}h OVER',
                      })}
                    </Badge>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                      {t('bucket.leftHours', {
                        hours: formatBucketHours(remainingHours),
                        defaultValue: '{{hours}}h left',
                      })}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
                  <div
                    className={`h-1.5 rounded-full ${meterColors.bg}`}
                    style={{ width: `${fillPercent}%` }}
                  ></div>
                </div>
              </li>
            );
          })}
          {hourBlocks.map((block) => {
            const remainingHours = block.hours_remaining;
            const totalHours = block.hours_total;
            const fillPercent = totalHours > 0 ? Math.max(0, Math.min(100, ((totalHours - remainingHours) / totalHours) * 100)) : 0;
            return (
              <li
                key={block.block_id}
                className="rounded-md border border-[rgb(var(--color-border-100))] p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
                    {t('hourBlocks.blockLabel', { service: block.service_name, defaultValue: '{{service}} block' })}
                  </span>
                  {block.expiring_soon_days != null ? (
                    <Badge variant="warning" size="sm" className="shrink-0">
                      {t('hourBlocks.expiringSoon', {
                        days: block.expiring_soon_days,
                        defaultValue: 'Expires in {{days}}d',
                      })}
                    </Badge>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                      {t('bucket.leftHours', {
                        hours: remainingHours.toFixed(1),
                        defaultValue: '{{hours}}h left',
                      })}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
                  <div
                    className="h-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"
                    style={{ width: `${fillPercent}%` }}
                  ></div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
