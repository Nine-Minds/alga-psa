'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';
import TimePeriodForm from './TimePeriodForm';
import { getTimePeriodSettings, fetchAllTimePeriods } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { MoreVertical } from 'lucide-react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Temporal } from '@js-temporal/polyfill';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Helper to get the last inclusive day from an exclusive end_date
// end_date is the day AFTER the period ends (exclusive boundary)
function getLastInclusiveDay(exclusiveEndDate: string): string {
  const endDate = Temporal.PlainDate.from(exclusiveEndDate);
  const lastDay = endDate.subtract({ days: 1 });
  return lastDay.toString();
}

const TimePeriodList: React.FC = () => {
  const { t } = useTranslation(['msp/settings', 'common']);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [timePeriods, setTimePeriods] = useState<ITimePeriodView[]>([]);
  const [settings, setSettings] = useState<ITimePeriodSettings[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<ITimePeriodView | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleTimePeriodCreated = (newPeriod: ITimePeriodView) => {
    if (mode === 'edit') {
      setTimePeriods(timePeriods.map((p):ITimePeriodView =>
        p.period_id === newPeriod.period_id ? newPeriod : p
      ));
    } else {
      setTimePeriods([...timePeriods, newPeriod]);
    }
  };

  const handleTimePeriodDeleted = () => {
    if (selectedPeriod) {
      setTimePeriods(timePeriods.filter(p => p.period_id !== selectedPeriod.period_id));
    }
  };

  const handleEdit = (period: ITimePeriodView) => {
    setSelectedPeriod(period);
    setMode('edit');
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setSelectedPeriod(null);
    setMode('create');
  };

  const handleRowClick = (period: ITimePeriodView) => {
    handleEdit(period);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const [timePeriodSettings, allTimePeriods] = await Promise.all([
          getTimePeriodSettings(),
          fetchAllTimePeriods()
        ]);
        if (isActionMessageError(timePeriodSettings) || isActionPermissionError(timePeriodSettings)) {
          setLoadError(getErrorMessage(timePeriodSettings));
          setSettings(null);
          setTimePeriods([]);
          return;
        }
        if (isActionMessageError(allTimePeriods) || isActionPermissionError(allTimePeriods)) {
          setLoadError(getErrorMessage(allTimePeriods));
          setSettings(timePeriodSettings);
          setTimePeriods([]);
          return;
        }
        setSettings(timePeriodSettings);
        setTimePeriods(allTimePeriods);
        setLoadError(null);
      } catch (error) {
        console.error('Error fetching time period data:', error);
        setLoadError(t('timeEntry.periods.errors.load'));
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  // Define column definitions for the DataTable
  const columns: ColumnDefinition<ITimePeriodView>[] = [
    {
      title: t('timeEntry.periods.columns.startDate'),
      dataIndex: 'start_date',
      render: (value) => value.slice(0, 10)
    },
    {
      title: t('timeEntry.periods.columns.endDate'),
      dataIndex: 'end_date',
      // Show the last inclusive day (end_date is exclusive - the day AFTER the period)
      render: (value) => getLastInclusiveDay(value)
    },
    {
      title: t('timeEntry.periods.columns.actions'),
      dataIndex: 'period_id',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`time-period-actions-menu-${record.period_id}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{t('timeEntry.periods.openMenu')}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-period-${record.period_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            >
              {t('common:actions.edit')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text={t('timeEntry.periods.loading')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('timeEntry.periods.title')}</CardTitle>
        <CardDescription>{t('timeEntry.periods.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loadError && (
          <div className="text-red-600 mb-4">
            {loadError}
          </div>
        )}
        <Button
          id="create-time-period-button"
          className="mb-4"
          onClick={() => {
            setMode('create');
            setSelectedPeriod(null);
            setIsFormOpen(true);
          }}
        >
          {t('timeEntry.periods.create')}
        </Button>
        <TimePeriodForm
          isOpen={isFormOpen}
          onClose={handleClose}
          onTimePeriodCreated={handleTimePeriodCreated}
          onTimePeriodDeleted={handleTimePeriodDeleted}
          settings={settings}
          existingTimePeriods={timePeriods}
          selectedPeriod={selectedPeriod}
          mode={mode}
        />
        <DataTable
          id="settings-time-periods-table"
          data={timePeriods}
          columns={columns}
          onRowClick={handleRowClick}
          pagination={true}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </CardContent>
    </Card>
  );
};

export default TimePeriodList;
