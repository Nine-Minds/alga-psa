'use client';

import React, { useMemo } from 'react';
import { Info } from 'lucide-react';
import type { ClientBucketUsageResult } from 'server/src/lib/actions/client-portal-actions/client-billing-metrics';

interface BucketUsageChartProps {
  bucketData: ClientBucketUsageResult;
}

const BucketUsageChart: React.FC<BucketUsageChartProps> = React.memo(({ bucketData }) => {
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
  const getColorClass = useMemo(() => {
    return (percent: number) => {
      if (percent >= 90) return 'text-red-500';
      if (percent >= 75) return 'text-yellow-500';
      return 'text-green-500';
    };
  }, []);
  
  // Memoize the color class to prevent unnecessary recalculation
  const colorClass = useMemo(() => getColorClass(percentage), [getColorClass, percentage]);

  return (
    <div className="border rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-medium text-gray-900">{bucketData.service_name}</h4>
          <p className="text-sm text-gray-500">
            {formatPeriodDate(bucketData.period_start)} - {formatPeriodDate(bucketData.period_end)}
          </p>
        </div>
        <div className="flex items-center">
          <span className="text-sm text-gray-500 mr-1">Bucket Contract Line</span>
          <Info className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      
      <div className="mt-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium">Usage</span>
          <span className={`text-sm font-medium ${colorClass}`}>
            {percentage}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className={`h-2.5 rounded-full ${colorClass}`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>{bucketData.hours_used.toFixed(1)} hours used</span>
          <span>{bucketData.hours_total.toFixed(1)} hours total</span>
        </div>
      </div>
      
      {bucketData.rolled_over_minutes > 0 && (
        <div className="mt-3 text-xs text-gray-500 flex items-center">
          <span className="mr-1">Includes {(bucketData.rolled_over_minutes / 60).toFixed(1)} rollover hours</span>
          <Info className="h-3 w-3 text-gray-400" />
        </div>
      )}
    </div>
  );
});

// Add display name for debugging
BucketUsageChart.displayName = 'BucketUsageChart';

export default BucketUsageChart;