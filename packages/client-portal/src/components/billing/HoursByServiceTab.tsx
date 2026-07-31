'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Clock } from 'lucide-react';
import { ColumnDefinition } from '@alga-psa/types';
import type { ClientHoursByServiceResult } from '@alga-psa/client-portal/actions';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

interface HoursByServiceTabProps {
  hoursByService: ClientHoursByServiceResult[];
  isHoursLoading: boolean;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  handleDateRangeChange: (e: React.ChangeEvent<HTMLInputElement>, field: 'startDate' | 'endDate') => void;
}

const HoursByServiceTab: React.FC<HoursByServiceTabProps> = React.memo(({
  hoursByService,
  isHoursLoading,
  dateRange,
  handleDateRangeChange
}) => {
  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  
  // Memoize columns to prevent unnecessary re-creation
  const hoursColumns: ColumnDefinition<ClientHoursByServiceResult>[] = useMemo(() => [
    {
      title: 'Service',
      dataIndex: 'service_name'
    },
    {
      title: 'Service Type',
      dataIndex: 'service_type_name',
      render: (value: string | null) => value || 'N/A'
    },
    {
      title: 'Hours',
      dataIndex: 'total_duration',
      render: (value: number) => (value / 60).toFixed(2)
    }
  ], []);

  // Memoize the date filter card to prevent unnecessary re-renders
  const dateFilterCard = useMemo(() => (
    <Card id="hours-date-filter-card" className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-medium">Date Range</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col">
            <label htmlFor="hours-start-date" className="text-sm font-medium text-gray-500 mb-1">
              Start Date
            </label>
            <DatePicker
              id="hours-start-date"
              label="Start Date"
              placeholder="Start Date"
              clearable
              className="w-full"
              value={dateFromString(dateRange.startDate)}
              onChange={(date) =>
                handleDateRangeChange(
                  { target: { value: dateToString(date) } } as React.ChangeEvent<HTMLInputElement>,
                  'startDate'
                )
              }
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hours-end-date" className="text-sm font-medium text-gray-500 mb-1">
              End Date
            </label>
            <DatePicker
              id="hours-end-date"
              label="End Date"
              placeholder="End Date"
              clearable
              className="w-full"
              value={dateFromString(dateRange.endDate)}
              onChange={(date) =>
                handleDateRangeChange(
                  { target: { value: dateToString(date) } } as React.ChangeEvent<HTMLInputElement>,
                  'endDate'
                )
              }
            />
          </div>
          <div className="flex items-end">
            <Button
              id="apply-date-filter-button"
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
    <div id="hours-service-content" className="py-4">
      {dateFilterCard}
      
      {isHoursLoading ? (
        <div id="hours-loading-skeleton" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : hoursByService.length === 0 ? (
        <Card id="hours-empty-state" className="p-6">
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">No hours data available</h3>
              <p className="mt-1 text-sm text-gray-500">
                There are no billable hours recorded for the selected date range.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div id="hours-table-container">
          <DataTable
            id="client-portal-hours-by-service-table"
            data={hoursByService}
            columns={hoursColumns}
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
HoursByServiceTab.displayName = 'HoursByServiceTab';

export default HoursByServiceTab;