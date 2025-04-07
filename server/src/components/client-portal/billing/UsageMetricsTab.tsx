'use client';

import React, { useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { BarChart } from 'lucide-react';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import type { ClientUsageMetricResult } from 'server/src/lib/actions/client-portal-actions/client-billing-metrics';
import { Skeleton } from 'server/src/components/ui/Skeleton';

interface UsageMetricsTabProps {
  usageMetrics: ClientUsageMetricResult[];
  isUsageMetricsLoading: boolean;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  handleDateRangeChange: (e: React.ChangeEvent<HTMLInputElement>, field: 'startDate' | 'endDate') => void;
}

const UsageMetricsTab: React.FC<UsageMetricsTabProps> = React.memo(({
  usageMetrics,
  isUsageMetricsLoading,
  dateRange,
  handleDateRangeChange
}) => {
  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Memoize columns to prevent unnecessary re-creation
  const usageMetricsColumns: ColumnDefinition<ClientUsageMetricResult>[] = useMemo(() => [
    {
      title: 'Service',
      dataIndex: 'service_name'
    },
    {
      title: 'Unit of Measure',
      dataIndex: 'unit_of_measure',
      render: (value: string | null) => value || 'N/A'
    },
    {
      title: 'Quantity',
      dataIndex: 'total_quantity',
      render: (value: number) => value.toFixed(2)
    }
  ], []);

  // Memoize the date filter card to prevent unnecessary re-renders
  const dateFilterCard = useMemo(() => (
    <Card id="usage-date-filter-card" className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-medium">Date Range</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col">
            <label htmlFor="usage-start-date" className="text-sm font-medium text-gray-500 mb-1">
              Start Date
            </label>
            <input
              id="usage-start-date"
              type="date"
              className="border border-gray-300 rounded-md px-3 py-2"
              value={dateRange.startDate}
              onChange={(e) => handleDateRangeChange(e, 'startDate')}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="usage-end-date" className="text-sm font-medium text-gray-500 mb-1">
              End Date
            </label>
            <input
              id="usage-end-date"
              type="date"
              className="border border-gray-300 rounded-md px-3 py-2"
              value={dateRange.endDate}
              onChange={(e) => handleDateRangeChange(e, 'endDate')}
            />
          </div>
          <div className="flex items-end">
            <Button
              id="apply-usage-filter-button"
              variant="outline"
              className="mb-0"
            >
              Apply Filter
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  ), [dateRange, handleDateRangeChange]);

  return (
    <div id="usage-metrics-content" className="py-4">
      {dateFilterCard}
      
      {isUsageMetricsLoading ? (
        <div id="usage-metrics-loading-skeleton" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : usageMetrics.length === 0 ? (
        <Card id="usage-metrics-empty-state" className="p-6">
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <BarChart className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">No usage metrics available</h3>
              <p className="mt-1 text-sm text-gray-500">
                There are no usage metrics recorded for the selected date range.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div id="usage-metrics-table-container">
          <DataTable
            id="usage-metrics-table"
            data={usageMetrics}
            columns={usageMetricsColumns}
            pagination={true}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        </div>
      )}
    </div>
  );
});

// Add display name for debugging
UsageMetricsTab.displayName = 'UsageMetricsTab';

export default UsageMetricsTab;