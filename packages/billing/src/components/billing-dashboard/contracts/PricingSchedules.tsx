'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, Calendar, Coins } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IContractPricingSchedule } from '@alga-psa/types';
import {
  getPricingSchedulesByContract,
  deletePricingSchedule
} from '@alga-psa/billing/actions/contractPricingScheduleActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { PricingScheduleDialog } from './PricingScheduleDialog';
import { formatCurrency } from '@alga-psa/core';
import { toPlainDate } from '@alga-psa/core';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PricingSchedulesProps {
  contractId: string;
  isReadOnly?: boolean;
}

const PricingSchedules: React.FC<PricingSchedulesProps> = ({ contractId, isReadOnly = false }) => {
  const { t } = useTranslation('msp/contracts');
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
      setError(t('pricingSchedules.list.errors.failedToLoadPricingSchedules', {
        defaultValue: 'Failed to load pricing schedules',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (isReadOnly) {
      return;
    }
    if (!confirm(t('pricingSchedules.list.dialogs.confirmDeleteSchedule', {
      defaultValue: 'Are you sure you want to delete this pricing schedule?',
    }))) {
      return;
    }

    try {
      await deletePricingSchedule(scheduleId);
      fetchSchedules();
    } catch (error) {
      console.error('Error deleting pricing schedule:', error);
      setError(t('pricingSchedules.list.errors.failedToDeletePricingSchedule', {
        defaultValue: 'Failed to delete pricing schedule',
      }));
    }
  };

  const handleEdit = (schedule: IContractPricingSchedule) => {
    if (isReadOnly) {
      return;
    }
    setEditingSchedule(schedule);
    setShowDialog(true);
  };

  const handleAddNew = () => {
    if (isReadOnly) {
      return;
    }
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
      title: t('pricingSchedules.list.columns.effectiveDate', { defaultValue: 'Effective Date' }),
      dataIndex: 'effective_date',
      render: (value) => toPlainDate(value as string).toLocaleString()
    },
    {
      title: t('pricingSchedules.list.columns.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value) => value
        ? toPlainDate(value as string).toLocaleString()
        : t('pricingSchedules.list.values.ongoing', { defaultValue: 'Ongoing' })
    },
    {
      title: t('pricingSchedules.list.columns.customRate', { defaultValue: 'Custom Rate' }),
      dataIndex: 'custom_rate',
      render: (value) => value !== undefined && value !== null
        ? formatCurrency(value / 100)
        : (
          <span className="text-muted-foreground">
            {t('pricingSchedules.list.values.useDefaultRate', { defaultValue: 'Use default rate' })}
          </span>
        )
    },
    {
      title: t('pricingSchedules.list.columns.notes', { defaultValue: 'Notes' }),
      dataIndex: 'notes',
      render: (value) => value || <span className="text-muted-foreground">{t('common.notAvailable', { defaultValue: '-' })}</span>
    },
    {
      title: t('pricingSchedules.list.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'schedule_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`pricing-schedule-actions-${value}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
              disabled={isReadOnly}
            >
              <span className="sr-only">{t('common.actions.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-pricing-schedule-${value}`}
              onClick={() => handleEdit(record)}
              disabled={isReadOnly}
            >
              {t('pricingSchedules.list.actions.editSchedule', { defaultValue: 'Edit Schedule' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-pricing-schedule-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => { e.stopPropagation(); handleDelete(value as string); }}
              disabled={isReadOnly}
            >
              {t('pricingSchedules.list.actions.deleteSchedule', { defaultValue: 'Delete Schedule' })}
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
            <h3 className="text-lg font-medium">
              {t('pricingSchedules.list.title', { defaultValue: 'Pricing Schedules' })}
            </h3>
            {isReadOnly ? (
              <p className="text-sm text-muted-foreground">
                {t('pricingSchedules.list.readOnlyNotice', {
                  defaultValue: 'This system-managed default contract is attribution-only. Pricing schedule authoring is disabled.',
                })}
              </p>
            ) : null}
            <Button
              id="add-pricing-schedule-button"
              onClick={handleAddNew}
              disabled={isReadOnly}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('pricingSchedules.list.actions.addSchedule', { defaultValue: 'Add Schedule' })}
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
              className="py-10 text-muted-foreground"
              spinnerProps={{ size: 'md' }}
              text={t('pricingSchedules.list.loading', { defaultValue: 'Loading pricing schedules' })}
            />
          ) : (
            <>
              {schedules.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground mb-2">
                    {t('pricingSchedules.list.empty.noPricingSchedules', { defaultValue: 'No pricing schedules yet' })}
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('pricingSchedules.list.empty.description', {
                      defaultValue: 'Add pricing schedules to define time-based rate changes for this contract',
                    })}
                  </p>
                </div>
              ) : (
                <>
                  {/* Timeline visualization */}
                  <div className="mb-6 p-4 bg-muted rounded-lg">
                    <h4 className="text-sm font-medium mb-3 flex items-center">
                      <Calendar className="h-4 w-4 mr-2" />
                      {t('pricingSchedules.list.timeline.title', { defaultValue: 'Pricing Timeline' })}
                    </h4>
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[rgb(var(--color-border-300))]" style={{ left: '10px' }}></div>

                      {/* Timeline items */}
                      <div className="space-y-4">
                        {schedules.map((schedule, index) => (
                          <div key={schedule.schedule_id} className="relative pl-8 pb-4">
                            {/* Timeline dot */}
                            <div className="absolute w-5 h-5 rounded-full bg-blue-500 border-4 border-white" style={{ left: '1px', top: '1px' }}></div>

                            <div className="bg-card p-3 rounded border shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="text-sm font-medium">
                                    {toPlainDate(schedule.effective_date).toLocaleString()}
                                    {schedule.end_date && (
                                      <span className="text-muted-foreground"> → {toPlainDate(schedule.end_date).toLocaleString()}</span>
                                    )}
                                    {!schedule.end_date && index === schedules.length - 1 && (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        → {t('pricingSchedules.list.values.ongoing', { defaultValue: 'Ongoing' })}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm text-muted-foreground mt-1 flex items-center">
                                    <Coins className="h-3 w-3 mr-1" />
                                    {schedule.custom_rate !== undefined && schedule.custom_rate !== null
                                      ? formatCurrency(schedule.custom_rate / 100)
                                      : t('pricingSchedules.list.values.defaultRate', { defaultValue: 'Default rate' })}
                                  </div>
                                </div>
                              </div>
                              {schedule.notes && (
                                <div className="text-xs text-muted-foreground mt-2">
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
                    id="pricing-schedules-table"
                    data={schedules}
                    columns={scheduleColumns}
                    pagination={false}
                    onRowClick={handleEdit}
                    rowClassName={() => (isReadOnly ? '' : 'cursor-pointer')}
                  />
                </>
              )}
            </>
          )}
        </Box>
      </Card>

      {showDialog && !isReadOnly && (
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
