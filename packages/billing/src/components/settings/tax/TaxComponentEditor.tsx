'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { MoreVertical, PlusCircle, Info } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
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

import { ITaxComponent } from '@alga-psa/types';
import { ColumnDefinition } from '@alga-psa/types';
import {
  getTaxComponentsByTaxRate,
  createTaxComponent,
  updateTaxComponent,
  deleteTaxComponent,
} from '@alga-psa/billing/actions';

// Zod schema for form validation
const taxComponentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name max 100 characters'),
  rate: z.number().min(0, 'Rate must be 0 or greater').max(100, 'Rate cannot exceed 100%'),
  sequence: z.number().int().min(1, 'Sequence must be at least 1'),
  is_compound: z.boolean(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
});

type TaxComponentFormData = z.infer<typeof taxComponentSchema>;

interface TaxComponentEditorProps {
  taxRateId: string;
  isReadOnly?: boolean;
}

export function TaxComponentEditor({ taxRateId, isReadOnly = false }: TaxComponentEditorProps) {
  const { t } = useTranslation('msp/billing-settings');
  const [components, setComponents] = useState<ITaxComponent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ITaxComponent | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [componentToDelete, setComponentToDelete] = useState<ITaxComponent | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const form = useForm<TaxComponentFormData>({
    resolver: zodResolver(taxComponentSchema),
    defaultValues: {
      name: '',
      rate: 0,
      sequence: 1,
      is_compound: false,
      start_date: null,
      end_date: null,
    },
  });

  const fetchComponents = useCallback(async () => {
    if (!taxRateId) return;
    setIsLoading(true);
    try {
      const fetchedComponents = await getTaxComponentsByTaxRate(taxRateId);
      setComponents(fetchedComponents);
    } catch (error) {
      handleError(error, t('tax.components.errors.load', { defaultValue: 'Failed to load tax components.' }));
    } finally {
      setIsLoading(false);
    }
  }, [taxRateId, t]);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  const getNextSequence = useCallback(() => {
    if (components.length === 0) return 1;
    return Math.max(...components.map(c => c.sequence)) + 1;
  }, [components]);

  const handleOpenDialog = (component: ITaxComponent | null = null) => {
    setEditingComponent(component);
    if (component) {
      form.reset({
        name: component.name,
        rate: component.rate,
        sequence: component.sequence,
        is_compound: component.is_compound,
        start_date: component.start_date ? component.start_date.split('T')[0] : null,
        end_date: component.end_date ? component.end_date.split('T')[0] : null,
      });
    } else {
      form.reset({
        name: '',
        rate: 0,
        sequence: getNextSequence(),
        is_compound: false,
        start_date: null,
        end_date: null,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingComponent(null);
    form.reset();
  };

  const handleOpenDeleteDialog = (component: ITaxComponent) => {
    setComponentToDelete(component);
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setComponentToDelete(null);
  };

  const onSubmit = async (data: TaxComponentFormData) => {
    setIsSubmitting(true);
    const isEditing = !!editingComponent;
    const successMessage = isEditing
      ? t('tax.components.toast.updated', { defaultValue: 'Tax component updated successfully.' })
      : t('tax.components.toast.created', { defaultValue: 'Tax component created successfully.' });
    const errorMessage = isEditing
      ? t('tax.components.errors.update', { defaultValue: 'Failed to update tax component.' })
      : t('tax.components.errors.create', { defaultValue: 'Failed to create tax component.' });

    try {
      if (isEditing) {
        await updateTaxComponent(editingComponent.tax_component_id, {
          name: data.name,
          rate: data.rate,
          sequence: data.sequence,
          is_compound: data.is_compound,
          start_date: data.start_date || undefined,
          end_date: data.end_date || undefined,
        });
      } else {
        await createTaxComponent({
          tax_rate_id: taxRateId,
          name: data.name,
          rate: data.rate,
          sequence: data.sequence,
          is_compound: data.is_compound,
          start_date: data.start_date || undefined,
          end_date: data.end_date || undefined,
        });
      }
      toast.success(successMessage);
      await fetchComponents();
      handleCloseDialog();
    } catch (error: any) {
      handleError(error, errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComponent = async () => {
    if (!componentToDelete) return;
    setIsSubmitting(true);

    try {
      await deleteTaxComponent(componentToDelete.tax_component_id);
      toast.success(t('tax.components.toast.deleted', { defaultValue: 'Tax component deleted successfully.' }));
      await fetchComponents();
      handleCloseDeleteDialog();
    } catch (error: any) {
      handleError(error, t('tax.components.errors.delete', { defaultValue: 'Failed to delete tax component.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate tax preview for a given base amount
  const calculatePreview = useMemo(() => {
    const baseAmount = 100; // $100 example
    let taxableAmount = baseAmount;
    let totalTax = 0;
    const breakdown: { name: string; rate: number; tax: number; isCompound: boolean }[] = [];

    const sortedComponents = [...components].sort((a, b) => a.sequence - b.sequence);

    for (const component of sortedComponents) {
      const componentTax = (taxableAmount * component.rate) / 100;
      totalTax += componentTax;
      breakdown.push({
        name: component.name,
        rate: component.rate,
        tax: componentTax,
        isCompound: component.is_compound,
      });

      if (component.is_compound) {
        taxableAmount += componentTax;
      }
    }

    const effectiveRate = (totalTax / baseAmount) * 100;

    return { baseAmount, totalTax, effectiveRate, breakdown };
  }, [components]);

  const columns: ColumnDefinition<ITaxComponent>[] = [
    {
      title: t('common.columns.sequence', { defaultValue: 'Seq' }),
      dataIndex: 'sequence',
      width: '60px',
    },
    {
      title: t('common.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
    },
    {
      title: t('common.columns.rate', { defaultValue: 'Rate' }),
      dataIndex: 'rate',
      render: (value: number) => `${value}%`,
    },
    {
      title: t('tax.components.fields.compound.label', { defaultValue: 'Compound Tax' }),
      dataIndex: 'is_compound',
      render: (value: boolean) => (
        <Badge variant={value ? 'default' : 'outline'}>
          {value
            ? t('common.statuses.yes', { defaultValue: 'Yes' })
            : t('common.statuses.no', { defaultValue: 'No' })}
        </Badge>
      ),
    },
    {
      title: t('common.columns.dateRange', { defaultValue: 'Date Range' }),
      dataIndex: 'start_date',
      render: (_: any, component: ITaxComponent) => {
        if (!component.start_date && !component.end_date) {
          return t('tax.components.dateRange.always', { defaultValue: 'Always' });
        }
        const start = component.start_date
          ? new Date(component.start_date).toLocaleDateString()
          : t('tax.components.dateRange.any', { defaultValue: 'Any' });
        const end = component.end_date
          ? new Date(component.end_date).toLocaleDateString()
          : t('tax.components.dateRange.ongoing', { defaultValue: 'Ongoing' });
        return `${start} - ${end}`;
      },
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      width: '80px',
      render: (_: any, component: ITaxComponent) => {
        if (isReadOnly) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                id={`tax-component-actions-menu-${component.tax_component_id}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                disabled={isSubmitting}
              >
                <span className="sr-only">{t('common.a11y.openMenu', { defaultValue: 'Open menu' })}</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-tax-component-${component.tax_component_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDialog(component);
                }}
                disabled={isSubmitting}
              >
                {t('tax.components.actions.edit', { defaultValue: 'Edit' })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`delete-tax-component-${component.tax_component_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDeleteDialog(component);
                }}
                className="text-red-600 focus:text-red-600"
                disabled={isSubmitting}
              >
                {t('tax.components.actions.delete', { defaultValue: 'Delete' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-4" id="tax-component-editor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">
            {t('tax.components.title', { defaultValue: 'Tax Components' })}
          </h4>
          <Tooltip content={t('tax.components.tooltip', {
            defaultValue: 'Components are applied in sequence order. Compound components calculate tax on the base amount plus previous taxes.'
          })}>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </div>
        {!isReadOnly && (
          <Button
            size="sm"
            onClick={() => handleOpenDialog()}
            id="add-tax-component-button"
            disabled={isSubmitting}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {t('tax.components.actions.add', { defaultValue: 'Add Component' })}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="text-center p-4 text-muted-foreground">
          {t('tax.components.loading', { defaultValue: 'Loading components...' })}
        </div>
      )}

      {!isLoading && components.length === 0 && (
        <div className="text-center p-4 text-muted-foreground border border-dashed rounded-lg">
          {t('tax.components.empty', {
            defaultValue: 'No tax components defined. Add components to create a composite tax.'
          })}
        </div>
      )}

      {!isLoading && components.length > 0 && (
        <>
          <DataTable
            id="tax-components-table"
            columns={columns}
            data={components}
            onRowClick={isReadOnly ? undefined : (row) => handleOpenDialog(row)}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />

          {/* Tax Calculation Preview */}
          <div className="bg-muted/50 rounded-lg p-4 mt-4">
            <h5 className="text-sm font-medium mb-2">
              {t('tax.components.preview.title', {
                amount: `$${calculatePreview.baseAmount.toFixed(2)}`,
                defaultValue: 'Calculation Preview ({{amount}} base)'
              })}
            </h5>
            <div className="space-y-1 text-sm">
              {calculatePreview.breakdown.map((item, index) => (
                <div key={index} className="flex justify-between">
                  <span>
                    {item.name} ({item.rate}%{item.isCompound
                      ? t('tax.components.preview.compoundSuffix', { defaultValue: ', compound' })
                      : ''}):
                  </span>
                  <span>${item.tax.toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t pt-1 mt-1 flex justify-between font-medium">
                <span>{t('tax.components.preview.totalTax', { defaultValue: 'Total Tax:' })}</span>
                <span>
                  ${calculatePreview.totalTax.toFixed(2)} (
                  {t('tax.components.preview.effective', {
                    rate: calculatePreview.effectiveRate.toFixed(2),
                    defaultValue: 'Effective: {{rate}}%'
                  })}
                  )
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add/Edit Dialog */}
      <GenericDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        title={
          editingComponent
            ? t('tax.components.dialog.editTitle', { defaultValue: 'Edit Tax Component' })
            : t('tax.components.dialog.addTitle', { defaultValue: 'Add Tax Component' })
        }
        id="tax-component-dialog"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-component-form">
          <div className="space-y-1">
            <Label htmlFor="tax-component-name-field">
              {t('tax.components.fields.name.label', { defaultValue: 'Name *' })}
            </Label>
            <Input
              id="tax-component-name-field"
              placeholder={t('tax.components.fields.name.placeholder', {
                defaultValue: 'e.g., Federal Tax, State Tax'
              })}
              {...form.register('name')}
              disabled={isSubmitting}
              aria-invalid={form.formState.errors.name ? "true" : "false"}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-red-600" role="alert">
                {form.formState.errors.name?.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tax-component-rate-field">
                {t('tax.components.fields.rate.label', { defaultValue: 'Rate (%) *' })}
              </Label>
              <Controller
                name="rate"
                control={form.control}
                render={({ field }) => (
                  <Input
                    id="tax-component-rate-field"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder={t('tax.components.fields.rate.placeholder', {
                      defaultValue: 'e.g., 10'
                    })}
                    value={field.value}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    disabled={isSubmitting}
                    aria-invalid={form.formState.errors.rate ? "true" : "false"}
                  />
                )}
              />
              {form.formState.errors.rate && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.rate?.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="tax-component-sequence-field">
                {t('tax.components.fields.sequence.label', { defaultValue: 'Sequence *' })}
              </Label>
              <Controller
                name="sequence"
                control={form.control}
                render={({ field }) => (
                  <Input
                    id="tax-component-sequence-field"
                    type="number"
                    min="1"
                    placeholder={t('tax.components.fields.sequence.placeholder', {
                      defaultValue: 'e.g., 1'
                    })}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                    disabled={isSubmitting}
                    aria-invalid={form.formState.errors.sequence ? "true" : "false"}
                  />
                )}
              />
              {form.formState.errors.sequence && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.sequence?.message}
                </p>
              )}
            </div>
          </div>

          <Controller
            name="is_compound"
            control={form.control}
            render={({ field: { onChange, value, ref } }) => (
              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label htmlFor="tax-component-compound-field">
                    {t('tax.components.fields.compound.label', { defaultValue: 'Compound Tax' })}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('tax.components.fields.compound.help', {
                      defaultValue: 'Calculate on base + previous taxes'
                    })}
                  </p>
                </div>
                <Switch
                  id="tax-component-compound-field"
                  checked={value}
                  onCheckedChange={onChange}
                  disabled={isSubmitting}
                  ref={ref}
                />
              </div>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tax-component-start-date-field">
                {t('tax.components.fields.startDate.label', { defaultValue: 'Start Date (Optional)' })}
              </Label>
              <Input
                id="tax-component-start-date-field"
                type="date"
                {...form.register('start_date')}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tax-component-end-date-field">
                {t('tax.components.fields.endDate.label', { defaultValue: 'End Date (Optional)' })}
              </Label>
              <Input
                id="tax-component-end-date-field"
                type="date"
                {...form.register('end_date')}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDialog} id="tax-component-dialog-cancel-button">
              {t('tax.components.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting} id="tax-component-dialog-save-button">
              {isSubmitting
                ? t('tax.components.actions.saving', { defaultValue: 'Saving...' })
                : t('tax.components.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </form>
      </GenericDialog>

      {/* Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        title={t('tax.components.dialog.deleteTitle', { defaultValue: 'Delete Tax Component' })}
        id="tax-component-delete-dialog"
      >
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            {t('tax.components.delete.message', {
              name: componentToDelete?.name ?? '',
              defaultValue: 'Are you sure you want to delete the component "{{name}}"? This action cannot be undone.'
            })}
          </p>
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDeleteDialog} id="cancel-delete-tax-component-button">
              {t('tax.components.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteComponent}
              disabled={isSubmitting}
              id="confirm-delete-tax-component-button"
            >
              {isSubmitting
                ? t('tax.components.actions.deleting', { defaultValue: 'Deleting...' })
                : t('tax.components.actions.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        </div>
      </GenericDialog>
    </div>
  );
}

export default TaxComponentEditor;
