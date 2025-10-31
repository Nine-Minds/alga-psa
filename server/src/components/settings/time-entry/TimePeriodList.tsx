'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { ITimePeriodSettings, ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import TimePeriodForm from './TimePeriodForm';
import { getTimePeriodSettings, fetchAllTimePeriods } from 'server/src/lib/actions/timePeriodsActions';
import { MoreVertical } from 'lucide-react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

const TimePeriodList: React.FC = () => {
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [timePeriods, setTimePeriods] = useState<ITimePeriodView[]>([]);
  const [settings, setSettings] = useState<ITimePeriodSettings[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<ITimePeriodView | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [isLoading, setIsLoading] = useState<boolean>(true);

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
        setSettings(timePeriodSettings);
        setTimePeriods(allTimePeriods);
      } catch (error) {
        console.error('Error fetching time period data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
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
              id={`time-period-actions-menu-${record.period_id}`}
              variant="ghost"
              className="h-8 w-8 p-0"
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

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time Periods</CardTitle>
        <CardDescription>View and manage time entry periods for time tracking</CardDescription>
      </CardHeader>
      <CardContent>
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