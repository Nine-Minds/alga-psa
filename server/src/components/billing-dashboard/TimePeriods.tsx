'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { ITimePeriodSettings, ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import TimePeriodForm from './TimePeriodForm';
import { getTimePeriodSettings } from 'server/src/lib/actions/timePeriodsActions';
import { ISO8601String } from 'server/src/types/types.d';
import { MoreVertical } from 'lucide-react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

interface TimePeriodsProps {
  initialTimePeriods: ITimePeriodView[];
}

const TimePeriods: React.FC<TimePeriodsProps> = ({ initialTimePeriods }) => {
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [timePeriods, setTimePeriods] = useState<ITimePeriodView[]>(initialTimePeriods);
  const [settings, setSettings] = useState<ITimePeriodSettings[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<ITimePeriodView | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(10);

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

  useEffect(() => {
    console.log('initial time periods', initialTimePeriods);

    async function fetchSettings() {
      const timePeriodSettings = await getTimePeriodSettings();
      // Assuming we only have one active setting
      setSettings(timePeriodSettings);
    }
    fetchSettings();
  }, []);

  // Define column definitions for the DataTable
  const columns: ColumnDefinition<ITimePeriodView>[] = [
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value) => value.slice(0, 10)
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => value.slice(0, 10)
    },
    {
      title: 'Actions',
      dataIndex: 'period_id',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`time-period-actions-menu-${record.period_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
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
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <Button
        id="create-time-period-button"
        className="mb-4"
        onClick={() => {
          setMode('create');
          setSelectedPeriod(null);
          setIsFormOpen(true);
        }}
      >
        Create New Time Period
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
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Time Period Management</h3>
          <p className="text-sm text-gray-500">Manage billing cycles and time periods</p>
        </CardHeader>
        <CardContent>
          <DataTable
            id="time-periods-table"
            data={timePeriods}
            columns={columns}
            onRowClick={handleRowClick}
            pagination={true}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            pageSize={pageSize}
          />
        </CardContent>
      </Card>
    </>
  );
};

export default TimePeriods;
