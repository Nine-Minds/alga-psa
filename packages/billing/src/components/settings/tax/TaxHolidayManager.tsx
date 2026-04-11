'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { MoreVertical, PlusCircle, Info, Calendar, CalendarDays } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import GenericDialog from '@alga-psa/ui/components/GenericDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { ITaxHoliday } from '@alga-psa/types';
import { ColumnDefinition } from '@alga-psa/types';
import {
  getTaxHolidaysByTaxRate,
  createTaxHoliday,
  updateTaxHoliday,
  deleteTaxHoliday,
} from '@alga-psa/billing/actions';

// Zod schema for form validation
const taxHolidaySchema = z.object({
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  description: z.string().max(255, 'Description max 255 characters').optional(),
}).refine(
  (data) => {
    const start = new Date(data.start_date);
    const end = new Date(data.end_date);
    return end > start;
  },
  {
    message: 'End date must be after start date',
    path: ['end_date'],
  }
);

type TaxHolidayFormData = z.infer<typeof taxHolidaySchema>;

type HolidayStatus = 'active' | 'upcoming' | 'expired';

interface TaxHolidayManagerProps {
  taxRateId: string;
  taxRateName?: string;
  isReadOnly?: boolean;
}

export function TaxHolidayManager({ taxRateId, taxRateName, isReadOnly = false }: TaxHolidayManagerProps) {
  const { t } = useTranslation('msp/billing-settings');
  const [holidays, setHolidays] = useState<ITaxHoliday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<ITaxHoliday | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [holidayToDelete, setHolidayToDelete] = useState<ITaxHoliday | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const form = useForm<TaxHolidayFormData>({
    resolver: zodResolver(taxHolidaySchema),
    defaultValues: {
      start_date: '',
      end_date: '',
      description: '',
    },
  });

  const fetchHolidays = useCallback(async () => {
    if (!taxRateId) return;
    setIsLoading(true);
    try {
      const fetchedHolidays = await getTaxHolidaysByTaxRate(taxRateId);
      setHolidays(fetchedHolidays);
    } catch (error) {
      handleError(error, t('tax.holidays.errors.load', { defaultValue: 'Failed to load tax holidays.' }));
    } finally {
      setIsLoading(false);
    }
  }, [taxRateId, t]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  // Determine the status of a holiday
  const getHolidayStatus = useCallback((holiday: ITaxHoliday): HolidayStatus => {
    const now = new Date();
    const start = new Date(holiday.start_date);
    const end = new Date(holiday.end_date);

    if (now >= start && now <= end) {
      return 'active';
    } else if (now < start) {
      return 'upcoming';
    } else {
      return 'expired';
    }
  }, []);

  // Count holidays by status
  const holidayStats = useMemo(() => {
    const stats = { active: 0, upcoming: 0, expired: 0 };
    holidays.forEach(holiday => {
      const status = getHolidayStatus(holiday);
      stats[status]++;
    });
    return stats;
  }, [holidays, getHolidayStatus]);

  const handleOpenDialog = (holiday: ITaxHoliday | null = null) => {
    setEditingHoliday(holiday);
    if (holiday) {
      form.reset({
        start_date: holiday.start_date.split('T')[0],
        end_date: holiday.end_date.split('T')[0],
        description: holiday.description || '',
      });
    } else {
      // Default to a week from today
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);

      form.reset({
        start_date: today.toISOString().split('T')[0],
        end_date: nextWeek.toISOString().split('T')[0],
        description: '',
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingHoliday(null);
    form.reset();
  };

  const handleOpenDeleteDialog = (holiday: ITaxHoliday) => {
    setHolidayToDelete(holiday);
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setHolidayToDelete(null);
  };

  const onSubmit = async (data: TaxHolidayFormData) => {
    setIsSubmitting(true);
    const isEditing = !!editingHoliday;
    const successMessage = isEditing
      ? t('tax.holidays.toast.updated', { defaultValue: 'Tax holiday updated successfully.' })
      : t('tax.holidays.toast.created', { defaultValue: 'Tax holiday created successfully.' });
    const errorMessage = isEditing
      ? t('tax.holidays.errors.update', { defaultValue: 'Failed to update tax holiday.' })
      : t('tax.holidays.errors.create', { defaultValue: 'Failed to create tax holiday.' });

    try {
      if (isEditing) {
        await updateTaxHoliday(editingHoliday.tax_holiday_id, {
          start_date: data.start_date,
          end_date: data.end_date,
          description: data.description || undefined,
        });
      } else {
        await createTaxHoliday({
          tax_rate_id: taxRateId,
          start_date: data.start_date,
          end_date: data.end_date,
          description: data.description || undefined,
        });
      }
      toast.success(successMessage);
      await fetchHolidays();
      handleCloseDialog();
    } catch (error: any) {
      handleError(error, errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHoliday = async () => {
    if (!holidayToDelete) return;
    setIsSubmitting(true);

    try {
      await deleteTaxHoliday(holidayToDelete.tax_holiday_id);
      toast.success(t('tax.holidays.toast.deleted', { defaultValue: 'Tax holiday deleted successfully.' }));
      await fetchHolidays();
      handleCloseDeleteDialog();
    } catch (error: any) {
      handleError(error, t('tax.holidays.errors.delete', { defaultValue: 'Failed to delete tax holiday.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: HolidayStatus) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{t('common.statuses.active', { defaultValue: 'Active' })}</Badge>;
      case 'upcoming':
        return <Badge variant="info">{t('common.statuses.upcoming', { defaultValue: 'Upcoming' })}</Badge>;
      case 'expired':
        return <Badge variant="outline">{t('common.statuses.expired', { defaultValue: 'Expired' })}</Badge>;
    }
  };

  const columns: ColumnDefinition<ITaxHoliday>[] = [
    {
      title: t('common.columns.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      render: (value: string) => formatDate(value),
    },
    {
      title: t('common.columns.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value: string) => formatDate(value),
    },
    {
      title: t('common.columns.description', { defaultValue: 'Description' }),
      dataIndex: 'description',
      render: (value: string | undefined) => value || t('common.emptyValue', { defaultValue: '-' }),
    },
    {
      title: t('common.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (_: any, holiday: ITaxHoliday) => getStatusBadge(getHolidayStatus(holiday)),
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      width: '80px',
      render: (_: any, holiday: ITaxHoliday) => {
        if (isReadOnly) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                id={`tax-holiday-actions-menu-${holiday.tax_holiday_id}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                disabled={isSubmitting}
              >
                <span className="sr-only">{t('common.a11y.openMenu', { defaultValue: 'Open menu' })}</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-tax-holiday-${holiday.tax_holiday_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDialog(holiday);
                }}
                disabled={isSubmitting}
              >
                {t('tax.holidays.actions.edit', { defaultValue: 'Edit' })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`delete-tax-holiday-${holiday.tax_holiday_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDeleteDialog(holiday);
                }}
                className="text-red-600 focus:text-red-600"
                disabled={isSubmitting}
              >
                {t('tax.holidays.actions.delete', { defaultValue: 'Delete' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-4" id="tax-holiday-manager">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">
            {taxRateName
              ? t('tax.holidays.titleWithName', {
                  name: taxRateName,
                  defaultValue: 'Tax Holidays for {{name}}'
                })
              : t('tax.holidays.title', { defaultValue: 'Tax Holidays' })}
          </h4>
          <Tooltip content={t('tax.holidays.tooltip', {
            defaultValue: 'Tax holidays are temporary periods where this tax is not applied. Use them for promotions, seasonal exemptions, or government-mandated tax holidays.'
          })}>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </div>
        {!isReadOnly && (
          <Button
            size="sm"
            onClick={() => handleOpenDialog()}
            id="add-tax-holiday-button"
            disabled={isSubmitting}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {t('tax.holidays.actions.add', { defaultValue: 'Add Holiday' })}
          </Button>
        )}
      </div>

      {/* Status summary */}
      {!isLoading && holidays.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4 text-green-500" />
            {t('tax.holidays.summary.active', {
              count: holidayStats.active,
              defaultValue: '{{count}} active'
            })}
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-blue-500" />
            {t('tax.holidays.summary.upcoming', {
              count: holidayStats.upcoming,
              defaultValue: '{{count}} upcoming'
            })}
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {t('tax.holidays.summary.expired', {
              count: holidayStats.expired,
              defaultValue: '{{count}} expired'
            })}
          </span>
        </div>
      )}

      {isLoading && (
        <div className="text-center p-4 text-muted-foreground">
          {t('tax.holidays.loading', { defaultValue: 'Loading holidays...' })}
        </div>
      )}

      {!isLoading && holidays.length === 0 && (
        <div className="text-center p-4 text-muted-foreground border border-dashed rounded-lg">
          {t('tax.holidays.empty', {
            defaultValue: 'No tax holidays defined. Add holidays to temporarily exempt this tax during specific periods.'
          })}
        </div>
      )}

      {!isLoading && holidays.length > 0 && (
        <DataTable
          id="tax-holidays-table"
          columns={columns}
          data={holidays}
          onRowClick={isReadOnly ? undefined : (row) => handleOpenDialog(row)}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      )}

      {/* Add/Edit Dialog */}
      <GenericDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        title={
          editingHoliday
            ? t('tax.holidays.dialog.editTitle', { defaultValue: 'Edit Tax Holiday' })
            : t('tax.holidays.dialog.addTitle', { defaultValue: 'Add Tax Holiday' })
        }
        id="tax-holiday-dialog"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-holiday-form">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tax-holiday-start-date-field">
                {t('tax.holidays.fields.startDate.label', { defaultValue: 'Start Date *' })}
              </Label>
              <Input
                id="tax-holiday-start-date-field"
                type="date"
                {...form.register('start_date')}
                disabled={isSubmitting}
                aria-invalid={form.formState.errors.start_date ? "true" : "false"}
              />
              {form.formState.errors.start_date && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.start_date?.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="tax-holiday-end-date-field">
                {t('tax.holidays.fields.endDate.label', { defaultValue: 'End Date *' })}
              </Label>
              <Input
                id="tax-holiday-end-date-field"
                type="date"
                {...form.register('end_date')}
                disabled={isSubmitting}
                aria-invalid={form.formState.errors.end_date ? "true" : "false"}
              />
              {form.formState.errors.end_date && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.end_date?.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-holiday-description-field">
              {t('tax.holidays.fields.description.label', {
                defaultValue: 'Description (Optional)'
              })}
            </Label>
            <Input
              id="tax-holiday-description-field"
              placeholder={t('tax.holidays.fields.description.placeholder', {
                defaultValue: 'e.g., Black Friday Sale, Government Tax Holiday'
              })}
              {...form.register('description')}
              disabled={isSubmitting}
              aria-invalid={form.formState.errors.description ? "true" : "false"}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-600" role="alert">
                {form.formState.errors.description?.message}
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDialog} id="tax-holiday-dialog-cancel-button">
              {t('tax.holidays.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting} id="tax-holiday-dialog-save-button">
              {isSubmitting
                ? t('tax.holidays.actions.saving', { defaultValue: 'Saving...' })
                : t('tax.holidays.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </form>
      </GenericDialog>

      {/* Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        title={t('tax.holidays.dialog.deleteTitle', { defaultValue: 'Delete Tax Holiday' })}
        id="tax-holiday-delete-dialog"
      >
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            {t('tax.holidays.delete.message', {
              description: holidayToDelete?.description || t('tax.holidays.delete.untitled', { defaultValue: 'Untitled' }),
              dateRange: `${formatDate(holidayToDelete?.start_date || '')} - ${formatDate(holidayToDelete?.end_date || '')}`,
              defaultValue: 'Are you sure you want to delete the holiday "{{description}}" ({{dateRange}})? This action cannot be undone.'
            })}
          </p>
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDeleteDialog} id="cancel-delete-tax-holiday-button">
              {t('tax.holidays.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteHoliday}
              disabled={isSubmitting}
              id="confirm-delete-tax-holiday-button"
            >
              {isSubmitting
                ? t('tax.holidays.actions.deleting', { defaultValue: 'Deleting...' })
                : t('tax.holidays.actions.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        </div>
      </GenericDialog>
    </div>
  );
}

export default TaxHolidayManager;
