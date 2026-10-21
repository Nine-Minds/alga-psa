'use client';

import React, { useMemo } from 'react';
import { Info } from 'lucide-react';
import { useFormatters, useTranslation } from '../../lib/i18n/client';

interface BucketUsageData {
  plan_id: string;
  plan_name: string;
  service_id: string;
  service_name: string;
  display_label: string;
  total_minutes: number;
  minutes_used: number;
  rolled_over_minutes: number;
  remaining_minutes: number;
}

interface BucketUsageChartProps {
  bucketData: BucketUsageData;
}

const BucketUsageChart = React.memo(({ bucketData }: BucketUsageChartProps) => {
  const { t } = useTranslation('features/billing');
  const { formatNumber } = useFormatters();
  const formatHours = (minutes: number) => formatNumber(minutes / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const totalAvailableMinutes = bucketData.total_minutes + bucketData.rolled_over_minutes;
  const percentage = totalAvailableMinutes > 0
    ? Math.round((bucketData.minutes_used / totalAvailableMinutes) * 100)
    : 0;

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

  return (
    <div className={`border rounded-lg p-4 shadow-sm ${colorClasses.bgLight} ${colorClasses.border}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-medium text-foreground">{bucketData.display_label}</h4>
          <p className="text-sm text-muted-foreground">{bucketData.plan_name}</p>
        </div>
        <div className="flex items-center">
          <span className="text-sm text-muted-foreground mr-1">{t('bucketUsage.contractLine')}</span>
          <Info className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium">{t('bucketUsage.usage')}</span>
          <span className={`text-sm font-medium ${colorClasses.text}`}>
            {formatNumber(percentage / 100, { style: 'percent' })}
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full ${colorClasses.bg}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-xs text-muted-foreground">
          <span>{t('bucketUsage.hoursUsed', { hours: formatHours(bucketData.minutes_used) })}</span>
          <span>{t('bucketUsage.hoursTotal', { hours: formatHours(totalAvailableMinutes) })}</span>
        </div>
      </div>

      {bucketData.rolled_over_minutes > 0 && (
        <div className="mt-3 text-xs text-muted-foreground flex items-center">
          <span className="mr-1">{t('bucketUsage.rolloverHours', { hours: formatHours(bucketData.rolled_over_minutes) })}</span>
          <Info className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
});

// Add display name for debugging
BucketUsageChart.displayName = 'BucketUsageChart';

export default BucketUsageChart;
