'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import toast from 'react-hot-toast';
import { MoreVertical, PlusCircle, Info, Calendar, CalendarDays } from 'lucide-react';

import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Badge } from 'server/src/components/ui/Badge';
import GenericDialog from 'server/src/components/ui/GenericDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from 'server/src/components/ui/DropdownMenu';
import { Tooltip } from 'server/src/components/ui/Tooltip';

import { ITaxHoliday } from 'server/src/interfaces/tax.interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  getTaxHolidaysByTaxRate,
  createTaxHoliday,
  updateTaxHoliday,
  deleteTaxHoliday,
} from 'server/src/lib/actions/taxSettingsActions';

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
      console.error('Failed to fetch tax holidays:', error);
      toast.error('Failed to load tax holidays.');
    } finally {
      setIsLoading(false);
    }
  }, [taxRateId]);

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
    const successMessage = isEditing ? 'Tax holiday updated successfully.' : 'Tax holiday created successfully.';
    const errorMessage = isEditing ? 'Failed to update tax holiday.' : 'Failed to create tax holiday.';

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
      console.error(`${errorMessage}:`, error);
      toast.error(`${errorMessage} ${error?.message ? `(${error.message})` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHoliday = async () => {
    if (!holidayToDelete) return;
    setIsSubmitting(true);

    try {
      await deleteTaxHoliday(holidayToDelete.tax_holiday_id);
      toast.success('Tax holiday deleted successfully.');
      await fetchHolidays();
      handleCloseDeleteDialog();
    } catch (error: any) {
      console.error('Failed to delete tax holiday:', error);
      toast.error(`Failed to delete tax holiday. ${error?.message ? `(${error.message})` : ''}`);
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
        return <Badge variant="default" className="bg-green-500">Active</Badge>;
      case 'upcoming':
        return <Badge variant="default" className="bg-blue-500">Upcoming</Badge>;
      case 'expired':
        return <Badge variant="outline">Expired</Badge>;
    }
  };

  const columns: ColumnDefinition<ITaxHoliday>[] = [
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value: string) => formatDate(value),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: string) => formatDate(value),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (_: any, holiday: ITaxHoliday) => getStatusBadge(getHolidayStatus(holiday)),
    },
    {
      title: 'Actions',
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
                <span className="sr-only">Open menu</span>
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
                Edit
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
                Delete
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
          <h4 className="text-sm font-medium">Tax Holidays{taxRateName ? ` for ${taxRateName}` : ''}</h4>
          <Tooltip content="Tax holidays are temporary periods where this tax is not applied. Use them for promotions, seasonal exemptions, or government-mandated tax holidays.">
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
            Add Holiday
          </Button>
        )}
      </div>

      {/* Status summary */}
      {!isLoading && holidays.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4 text-green-500" />
            {holidayStats.active} active
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-blue-500" />
            {holidayStats.upcoming} upcoming
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-gray-400" />
            {holidayStats.expired} expired
          </span>
        </div>
      )}

      {isLoading && <div className="text-center p-4 text-muted-foreground">Loading holidays...</div>}

      {!isLoading && holidays.length === 0 && (
        <div className="text-center p-4 text-muted-foreground border border-dashed rounded-lg">
          No tax holidays defined. Add holidays to temporarily exempt this tax during specific periods.
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
        title={editingHoliday ? 'Edit Tax Holiday' : 'Add Tax Holiday'}
        id="tax-holiday-dialog"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-holiday-form">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tax-holiday-start-date-field">Start Date *</Label>
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
              <Label htmlFor="tax-holiday-end-date-field">End Date *</Label>
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
            <Label htmlFor="tax-holiday-description-field">Description (Optional)</Label>
            <Input
              id="tax-holiday-description-field"
              placeholder="e.g., Black Friday Sale, Government Tax Holiday"
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} id="tax-holiday-dialog-save-button">
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </GenericDialog>

      {/* Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        title="Delete Tax Holiday"
        id="tax-holiday-delete-dialog"
      >
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the holiday "{holidayToDelete?.description || 'Untitled'}" ({formatDate(holidayToDelete?.start_date || '')} - {formatDate(holidayToDelete?.end_date || '')})?
            This action cannot be undone.
          </p>
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDeleteDialog} id="cancel-delete-tax-holiday-button">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteHoliday}
              disabled={isSubmitting}
              id="confirm-delete-tax-holiday-button"
            >
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </GenericDialog>
    </div>
  );
}

export default TaxHolidayManager;
