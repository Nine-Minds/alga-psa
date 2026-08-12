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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('client-portal');
  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Memoize columns to prevent unnecessary re-creation
  const hoursColumns: ColumnDefinition<ClientHoursByServiceResult>[] = useMemo(() => [
    {
      title: t('billing.columns.service', { defaultValue: 'Service' }),
      dataIndex: 'service_name'
    },
    {
      title: t('billing.hoursByService.columns.serviceType', { defaultValue: 'Service Type' }),
      dataIndex: 'service_type_name',
      render: (value: string | null) => value || t('billing.columns.notAvailable', { defaultValue: 'N/A' })
    },
    {
      title: t('billing.hoursByService.columns.hours', { defaultValue: 'Hours' }),
      dataIndex: 'total_duration',
      render: (value: number) => (value / 60).toFixed(2)
    }
  ], [t]);

  // Memoize the date filter card to prevent unnecessary re-renders
  const dateFilterCard = useMemo(() => (
    <Card id="hours-date-filter-card" className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-medium">{t('billing.filters.dateRange', { defaultValue: 'Date Range' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col">
            <label htmlFor="hours-start-date" className="text-sm font-medium text-gray-500 mb-1">
              {t('billing.filters.startDate', { defaultValue: 'Start Date' })}
            </label>
            <DatePicker
              id="hours-start-date"
              label={t('billing.filters.startDate', { defaultValue: 'Start Date' })}
              placeholder={t('billing.filters.startDate', { defaultValue: 'Start Date' })}
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
              {t('billing.filters.endDate', { defaultValue: 'End Date' })}
            </label>
            <DatePicker
              id="hours-end-date"
              label={t('billing.filters.endDate', { defaultValue: 'End Date' })}
              placeholder={t('billing.filters.endDate', { defaultValue: 'End Date' })}
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
              {t('billing.filters.apply', { defaultValue: 'Apply Filter' })}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  ), [dateRange, handleDateRangeChange, t]);

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
              <h3 className="mt-2 text-lg font-medium text-gray-900">{t('billing.hoursByService.empty.title', { defaultValue: 'No hours data available' })}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('billing.hoursByService.empty.description', { defaultValue: 'There are no billable hours recorded for the selected date range.' })}
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