'use client';

import React, { useMemo } from 'react';
import { Info } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClientBucketUsageResult } from '@alga-psa/client-portal/actions';
import {
  getRemainingMinutes,
  getBucketMeterColors,
  formatBucketHours,
} from './bucketUsageMeter';

interface BucketUsageChartProps {
  bucketData: ClientBucketUsageResult;
}

const BucketUsageChart: React.FC<BucketUsageChartProps> = React.memo(({ bucketData }) => {
  const { t } = useTranslation('features/billing');
  // The legacy (flag-off) rendering was i18n-wired on main under the
  // client-portal namespace; the flag-on meter uses features/billing keys.
  const { t: tLegacy } = useTranslation('client-portal');
  const { enabled: remainingFirstEnabled } = useFeatureFlag('release-v1.5-feature', {
    defaultValue: false,
  });
  const percentage = Math.round(bucketData.percentage_used);

  // Format dates consistently - memoized to prevent recalculation
  const formatPeriodDate = useMemo(() => {
    return (dateStr: string | undefined) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    };
  }, []);

  // Determine color based on usage percentage - memoized to prevent recalculation
  const getColorClasses = useMemo(() => {
    return (percent: number) => {
      if (percent >= 90) return {
        text: 'text-destructive',
        bg: 'bg-destructive',
        bgLight: 'bg-destructive/10',
        border: 'border-destructive/30'
      };
      if (percent >= 75) return {
        text: 'text-warning',
        bg: 'bg-warning',
        bgLight: 'bg-warning/10',
        border: 'border-warning/30'
      };
      return {
        text: 'text-success',
        bg: 'bg-success',
        bgLight: 'bg-success/10',
        border: 'border-success/30'
      };
    };
  }, []);

  // Memoize the color classes to prevent unnecessary recalculation
  const colorClasses = useMemo(() => getColorClasses(percentage), [getColorClasses, percentage]);

  if (!remainingFirstEnabled) {
    return (
      <div className={`border rounded-lg p-4 shadow-sm ${colorClasses.bgLight} ${colorClasses.border}`}>
        <div className="flex justify-between items-start mb-2">
          <div>
            <h4 className="font-medium text-gray-900">{bucketData.service_name}</h4>
            <p className="text-sm text-gray-500">
              {formatPeriodDate(bucketData.period_start)} - {formatPeriodDate(bucketData.period_end)}
            </p>
          </div>
          <div className="flex items-center">
            <span className="text-sm text-gray-500 mr-1">{tLegacy('billing.bucketUsage.contractLineLabel', { defaultValue: 'Bucket Contract Line' })}</span>
            <Info className="h-4 w-4 text-gray-400" />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium">{tLegacy('billing.bucketUsage.usage', { defaultValue: 'Usage' })}</span>
            <span className={`text-sm font-medium ${colorClasses.text}`}>
              {percentage}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full ${colorClasses.bg}`}
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-500">
            <span>{tLegacy('billing.bucketUsage.hoursUsed', { defaultValue: '{{hours}} hours used', hours: bucketData.hours_used.toFixed(1) })}</span>
            <span>{tLegacy('billing.bucketUsage.hoursTotal', { defaultValue: '{{hours}} hours total', hours: bucketData.hours_total.toFixed(1) })}</span>
          </div>
        </div>

        {bucketData.rolled_over_minutes > 0 && (
          <div className="mt-3 text-xs text-gray-500 flex items-center">
            <span className="mr-1">{tLegacy('billing.bucketUsage.rolloverHours', { defaultValue: 'Includes {{hours}} rollover hours', hours: (bucketData.rolled_over_minutes / 60).toFixed(1) })}</span>
            <Info className="h-3 w-3 text-gray-400" />
          </div>
        )}
      </div>
    );
  }

  const remainingMinutes = getRemainingMinutes(bucketData);
  const totalWithRollover = bucketData.total_minutes + bucketData.rolled_over_minutes;
  const remainingHours = remainingMinutes / 60;
  const isOver = remainingMinutes < 0;
  const overHours = isOver ? -remainingHours : 0;
  const meterColors = getBucketMeterColors(remainingMinutes, totalWithRollover);

  const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

  let baseFillPercent = clampPercent(percentage);
  let overFillPercent = 0;
  if (isOver && percentage > 100) {
    // Overage: scale total consumption (used) onto the full track so the
    // overage stays INSIDE the bar instead of painting a segment beyond it.
    // With percentage_used uncapped upstream (2513% has been observed live),
    // an unclamped `width: percentage - 100` would streak far past the track.
    // base = 100 * total/used = 100 * 100/percentage; red = the remainder.
    baseFillPercent = clampPercent((100 * 100) / percentage);
    overFillPercent = clampPercent(100 - baseFillPercent);
  }
  const hasPeriod = Boolean(bucketData.period_start && bucketData.period_end);

  // Parse the date-only string directly so the chip is not shifted by the
  // server's timezone (new Date('2026-02-01') can render as Jan 31 in UTC−x).
  const formatPeriodChipDate = (dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${Number(month)}/${Number(day)}/${year}`;
  };

  return (
    <div className={`border rounded-lg p-4 shadow-sm ${meterColors.bgLight} ${meterColors.border}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-medium text-gray-900">{bucketData.service_name}</h4>
        </div>
        {hasPeriod && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {formatPeriodChipDate(bucketData.period_start)} – {formatPeriodChipDate(bucketData.period_end)}
          </span>
        )}
      </div>

      <div className="mt-3">
        {isOver ? (
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold ${meterColors.text}`}>
              {t('bucket.overageSummary', {
                hours: formatBucketHours(overHours),
                defaultValue: '{{hours}} hours over',
              })}
            </span>
            <Badge variant="error">{t('bucket.overBucket', 'OVER BUCKET')}</Badge>
          </div>
        ) : bucketData.rolled_over_minutes > 0 ? (
          <div className="text-lg font-semibold text-gray-900">
            {t('bucket.remainingSummaryWithRollover', {
              remaining: formatBucketHours(remainingHours),
              total: formatBucketHours(bucketData.hours_total),
              rollover: formatBucketHours(bucketData.rolled_over_minutes / 60),
              defaultValue: '{{remaining}} hours left of {{total}} (incl. {{rollover}} rollover)',
            })}
          </div>
        ) : (
          <div className="text-lg font-semibold text-gray-900">
            {t('bucket.remainingSummary', {
              remaining: formatBucketHours(remainingHours),
              total: formatBucketHours(bucketData.hours_total),
              defaultValue: '{{remaining}} hours left of {{total}}',
            })}
          </div>
        )}

        <div className="mt-2 flex justify-between items-center mb-1">
          <span className="text-sm font-medium">{t('bucket.usage', 'Usage')}</span>
          <span className={`text-sm font-medium ${meterColors.text}`}>
            {percentage}%
          </span>
        </div>
        <div className="relative w-full h-2.5 overflow-hidden rounded-full">
          <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
          <div
            className={`absolute inset-y-0 left-0 ${isOver ? 'rounded-l-full' : 'rounded-full'} ${meterColors.bg}`}
            style={{ width: `${baseFillPercent}%` }}
          ></div>
          {overFillPercent > 0 && (
            <div
              className="absolute inset-y-0 rounded-r-full bg-destructive"
              style={{ left: `${baseFillPercent}%`, width: `${overFillPercent}%` }}
            ></div>
          )}
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>
            {t('bucket.usedHours', {
              hours: formatBucketHours(bucketData.hours_used),
              defaultValue: '{{hours}}h used',
            })}
          </span>
          <span>
            {isOver
              ? t('bucket.overHours', {
                  hours: formatBucketHours(overHours),
                  defaultValue: '{{hours}}h OVER',
                })
              : t('bucket.leftHours', {
                  hours: formatBucketHours(remainingHours),
                  defaultValue: '{{hours}}h left',
                })}
          </span>
        </div>
      </div>
    </div>
  );
});

// Add display name for debugging
BucketUsageChart.displayName = 'BucketUsageChart';

export default BucketUsageChart;
