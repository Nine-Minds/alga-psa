'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Calendar, DollarSign } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContractPricingSchedule } from 'server/src/interfaces/contract.interfaces';
import {
  getPricingSchedulesByContract,
  deletePricingSchedule
} from 'server/src/lib/actions/contractPricingScheduleActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { PricingScheduleDialog } from './PricingScheduleDialog';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

interface PricingSchedulesProps {
  contractId: string;
}

const PricingSchedules: React.FC<PricingSchedulesProps> = ({ contractId }) => {
  const [schedules, setSchedules] = useState<IContractPricingSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<IContractPricingSchedule | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    if (contractId) {
      fetchSchedules();
    }
  }, [contractId]);

  const fetchSchedules = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPricingSchedulesByContract(contractId);
      setSchedules(data);
    } catch (error) {
      console.error('Error fetching pricing schedules:', error);
      setError('Failed to load pricing schedules');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this pricing schedule?')) {
      return;
    }

    try {
      await deletePricingSchedule(scheduleId);
      fetchSchedules();
    } catch (error) {
      console.error('Error deleting pricing schedule:', error);
      setError('Failed to delete pricing schedule');
    }
  };

  const handleEdit = (schedule: IContractPricingSchedule) => {
    setEditingSchedule(schedule);
    setShowDialog(true);
  };

  const handleAddNew = () => {
    setEditingSchedule(null);
    setShowDialog(true);
  };

  const handleDialogClose = () => {
    setShowDialog(false);
    setEditingSchedule(null);
  };

  const handleSaveSuccess = () => {
    fetchSchedules();
    handleDialogClose();
  };

  const scheduleColumns: ColumnDefinition<IContractPricingSchedule>[] = [
    {
      title: 'Effective Date',
      dataIndex: 'effective_date',
      render: (value) => toPlainDate(value as string).toLocaleString()
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => value ? toPlainDate(value as string).toLocaleString() : 'Ongoing'
    },
    {
      title: 'Custom Rate',
      dataIndex: 'custom_rate',
      render: (value) => value !== undefined && value !== null
        ? formatCurrency(value / 100)
        : <span className="text-gray-400">Use default rate</span>
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      render: (value) => value || <span className="text-gray-400">-</span>
    },
    {
      title: 'Actions',
      dataIndex: 'schedule_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`pricing-schedule-actions-${value}`}
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
              id={`edit-pricing-schedule-${value}`}
              onClick={() => handleEdit(record)}
            >
              Edit Schedule
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-pricing-schedule-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => { e.stopPropagation(); handleDelete(value as string); }}
            >
              Delete Schedule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">Pricing Schedules</h3>
            <Button
              id="add-pricing-schedule-button"
              onClick={handleAddNew}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Schedule
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <LoadingIndicator
              layout="stacked"
              className="py-10 text-gray-600"
              spinnerProps={{ size: 'md' }}
              text="Loading pricing schedules"
            />
          ) : (
            <>
              {schedules.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-gray-500 mb-2">No pricing schedules yet</p>
                  <p className="text-sm text-gray-400 mb-4">
                    Add pricing schedules to define time-based rate changes for this contract
                  </p>
                </div>
              ) : (
                <>
                  {/* Timeline visualization */}
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <h4 className="text-sm font-medium mb-3 flex items-center">
                      <Calendar className="h-4 w-4 mr-2" />
                      Pricing Timeline
                    </h4>
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-300" style={{ left: '10px' }}></div>

                      {/* Timeline items */}
                      <div className="space-y-4">
                        {schedules.map((schedule, index) => (
                          <div key={schedule.schedule_id} className="relative pl-8 pb-4">
                            {/* Timeline dot */}
                            <div className="absolute w-5 h-5 rounded-full bg-blue-500 border-4 border-white" style={{ left: '1px', top: '1px' }}></div>

                            <div className="bg-white p-3 rounded border shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="text-sm font-medium">
                                    {toPlainDate(schedule.effective_date).toLocaleString()}
                                    {schedule.end_date && (
                                      <span className="text-gray-500"> → {toPlainDate(schedule.end_date).toLocaleString()}</span>
                                    )}
                                    {!schedule.end_date && index === schedules.length - 1 && (
                                      <span className="text-gray-500"> → Ongoing</span>
                                    )}
                                  </div>
                                  <div className="text-sm text-gray-600 mt-1 flex items-center">
                                    <DollarSign className="h-3 w-3 mr-1" />
                                    {schedule.custom_rate !== undefined && schedule.custom_rate !== null
                                      ? formatCurrency(schedule.custom_rate / 100)
                                      : 'Default rate'}
                                  </div>
                                </div>
                              </div>
                              {schedule.notes && (
                                <div className="text-xs text-gray-500 mt-2">
                                  {schedule.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Data table */}
                  <DataTable
                    data={schedules}
                    columns={scheduleColumns}
                    pagination={false}
                    onRowClick={handleEdit}
                    rowClassName={() => 'cursor-pointer'}
                  />
                </>
              )}
            </>
          )}
        </Box>
      </Card>

      {showDialog && (
          <PricingScheduleDialog 
            contractId={contractId}
            schedule={editingSchedule}
            onClose={handleDialogClose}
            onSave={handleSaveSuccess}
          />
      )}
    </>
  );
};

export default PricingSchedules;
