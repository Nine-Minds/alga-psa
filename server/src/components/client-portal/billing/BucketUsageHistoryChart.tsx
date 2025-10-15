'use client';

import React, { useMemo } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface BucketUsageHistoryData {
  period_start: string;
  period_end: string;
  percentage_used: number;
  hours_used: number;
  hours_total: number;
}

interface BucketUsageHistoryChartProps {
  serviceName: string;
  historyData: BucketUsageHistoryData[];
}

const BucketUsageHistoryChart: React.FC<BucketUsageHistoryChartProps> = React.memo(({
  serviceName,
  historyData
}) => {
  // Sort data by period start date
  const sortedData = useMemo(() => {
    return [...historyData].sort((a, b) =>
      new Date(a.period_start).getTime() - new Date(b.period_start).getTime()
    );
  }, [historyData]);

  // Calculate trend
  const trend = useMemo(() => {
    if (sortedData.length < 2) return { direction: 'stable', percentage: 0 };

    const latest = sortedData[sortedData.length - 1];
    const previous = sortedData[sortedData.length - 2];
    const change = latest.percentage_used - previous.percentage_used;

    if (Math.abs(change) < 5) return { direction: 'stable', percentage: 0 };
    return {
      direction: change > 0 ? 'up' : 'down',
      percentage: Math.abs(change)
    };
  }, [sortedData]);

  // Get max value for scaling
  const maxPercentage = useMemo(() => {
    return Math.max(...sortedData.map(d => d.percentage_used), 100);
  }, [sortedData]);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (sortedData.length === 0) {
    return null;
  }

  return (
    <Card className="p-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className="font-medium text-gray-900">{serviceName}</h4>
          <p className="text-sm text-gray-500">Usage History</p>
        </div>
        <div className="flex items-center text-sm">
          {trend.direction === 'up' && (
            <>
              <TrendingUp className="h-4 w-4 text-red-500 mr-1" />
              <span className="text-red-600">+{trend.percentage.toFixed(1)}%</span>
            </>
          )}
          {trend.direction === 'down' && (
            <>
              <TrendingDown className="h-4 w-4 text-green-500 mr-1" />
              <span className="text-green-600">-{trend.percentage.toFixed(1)}%</span>
            </>
          )}
          {trend.direction === 'stable' && (
            <>
              <Minus className="h-4 w-4 text-gray-500 mr-1" />
              <span className="text-gray-600">Stable</span>
            </>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <div className="space-y-2">
        {sortedData.map((period, index) => {
          const percentage = Math.round(period.percentage_used);
          const barColor = percentage >= 90 ? 'bg-red-500' :
                          percentage >= 75 ? 'bg-yellow-500' :
                          'bg-green-500';
          const isLatest = index === sortedData.length - 1;

          return (
            <div key={`${period.period_start}-${period.period_end}`} className="relative">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-600 w-20">
                  {formatDate(period.period_start)}
                </span>
                <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${barColor} ${
                      isLatest ? 'opacity-100' : 'opacity-70'
                    }`}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                  >
                    <div className="absolute inset-0 flex items-center justify-end pr-2">
                      <span className="text-xs font-medium text-white">
                        {percentage}%
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-600 w-16 text-right">
                  {period.hours_used.toFixed(1)}h
                </span>
              </div>
              {isLatest && (
                <span className="absolute -top-1 left-20 text-[10px] text-blue-600 font-medium">
                  Current
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="mt-4 pt-3 border-t">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-gray-500">Avg Usage</p>
            <p className="text-sm font-medium">
              {Math.round(
                sortedData.reduce((sum, d) => sum + d.percentage_used, 0) / sortedData.length
              )}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Peak</p>
            <p className="text-sm font-medium">
              {Math.round(Math.max(...sortedData.map(d => d.percentage_used)))}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Periods</p>
            <p className="text-sm font-medium">{sortedData.length}</p>
          </div>
        </div>
      </div>
    </Card>
  );
});

BucketUsageHistoryChart.displayName = 'BucketUsageHistoryChart';

export default BucketUsageHistoryChart;
