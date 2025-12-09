'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import toast from 'react-hot-toast';
import { MoreVertical, PlusCircle, Info, AlertTriangle } from 'lucide-react';

import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import GenericDialog from 'server/src/components/ui/GenericDialog';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from 'server/src/components/ui/DropdownMenu';
import { Tooltip } from 'server/src/components/ui/Tooltip';

import { ITaxRateThreshold } from 'server/src/interfaces/tax.interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  getTaxRateThresholdsByTaxRate,
  createTaxRateThreshold,
  updateTaxRateThreshold,
  deleteTaxRateThreshold,
} from 'server/src/lib/actions/taxSettingsActions';

// Zod schema for form validation
const taxThresholdSchema = z.object({
  min_amount: z.number().min(0, 'Min amount must be 0 or greater'),
  max_amount: z.number().nullable().optional(),
  rate: z.number().min(0, 'Rate must be 0 or greater').max(100, 'Rate cannot exceed 100%'),
}).refine(
  (data) => {
    if (data.max_amount !== null && data.max_amount !== undefined) {
      return data.max_amount > data.min_amount;
    }
    return true;
  },
  {
    message: 'Max amount must be greater than min amount',
    path: ['max_amount'],
  }
);

type TaxThresholdFormData = z.infer<typeof taxThresholdSchema>;

interface TaxThresholdEditorProps {
  taxRateId: string;
  currency?: string;
  isReadOnly?: boolean;
}

export function TaxThresholdEditor({ taxRateId, currency = '$', isReadOnly = false }: TaxThresholdEditorProps) {
  const [thresholds, setThresholds] = useState<ITaxRateThreshold[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingThreshold, setEditingThreshold] = useState<ITaxRateThreshold | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [thresholdToDelete, setThresholdToDelete] = useState<ITaxRateThreshold | null>(null);
  const [previewAmount, setPreviewAmount] = useState<number>(75000);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const form = useForm<TaxThresholdFormData>({
    resolver: zodResolver(taxThresholdSchema),
    defaultValues: {
      min_amount: 0,
      max_amount: null,
      rate: 0,
    },
  });

  const fetchThresholds = useCallback(async () => {
    if (!taxRateId) return;
    setIsLoading(true);
    try {
      const fetchedThresholds = await getTaxRateThresholdsByTaxRate(taxRateId);
      setThresholds(fetchedThresholds);
    } catch (error) {
      console.error('Failed to fetch tax thresholds:', error);
      toast.error('Failed to load tax brackets.');
    } finally {
      setIsLoading(false);
    }
  }, [taxRateId]);

  useEffect(() => {
    fetchThresholds();
  }, [fetchThresholds]);

  // Check for gaps and overlaps in brackets
  const bracketIssues = useMemo(() => {
    const issues: string[] = [];
    const sortedThresholds = [...thresholds].sort((a, b) => a.min_amount - b.min_amount);

    for (let i = 0; i < sortedThresholds.length; i++) {
      const current = sortedThresholds[i];
      const next = sortedThresholds[i + 1];

      if (next) {
        const currentMax = current.max_amount;
        if (currentMax === null || currentMax === undefined) {
          issues.push(`Bracket starting at ${currency}${current.min_amount.toLocaleString()} has no max but is not the last bracket.`);
        } else if (currentMax < next.min_amount) {
          issues.push(`Gap between ${currency}${currentMax.toLocaleString()} and ${currency}${next.min_amount.toLocaleString()}`);
        } else if (currentMax > next.min_amount) {
          issues.push(`Overlap between brackets at ${currency}${currentMax.toLocaleString()}`);
        }
      }
    }

    return issues;
  }, [thresholds, currency]);

  // Get suggested min_amount for new bracket
  const getSuggestedMinAmount = useCallback(() => {
    if (thresholds.length === 0) return 0;
    const sortedThresholds = [...thresholds].sort((a, b) => a.min_amount - b.min_amount);
    const lastThreshold = sortedThresholds[sortedThresholds.length - 1];
    return lastThreshold.max_amount ?? lastThreshold.min_amount + 1;
  }, [thresholds]);

  const handleOpenDialog = (threshold: ITaxRateThreshold | null = null) => {
    setEditingThreshold(threshold);
    if (threshold) {
      form.reset({
        min_amount: threshold.min_amount,
        max_amount: threshold.max_amount ?? null,
        rate: threshold.rate,
      });
    } else {
      form.reset({
        min_amount: getSuggestedMinAmount(),
        max_amount: null,
        rate: 0,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingThreshold(null);
    form.reset();
  };

  const handleOpenDeleteDialog = (threshold: ITaxRateThreshold) => {
    setThresholdToDelete(threshold);
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setThresholdToDelete(null);
  };

  const onSubmit = async (data: TaxThresholdFormData) => {
    setIsSubmitting(true);
    const isEditing = !!editingThreshold;
    const successMessage = isEditing ? 'Tax bracket updated successfully.' : 'Tax bracket created successfully.';
    const errorMessage = isEditing ? 'Failed to update tax bracket.' : 'Failed to create tax bracket.';

    try {
      if (isEditing) {
        await updateTaxRateThreshold(editingThreshold.tax_rate_threshold_id, {
          min_amount: data.min_amount,
          max_amount: data.max_amount ?? undefined,
          rate: data.rate,
        });
      } else {
        await createTaxRateThreshold({
          tax_rate_id: taxRateId,
          min_amount: data.min_amount,
          max_amount: data.max_amount ?? undefined,
          rate: data.rate,
        });
      }
      toast.success(successMessage);
      await fetchThresholds();
      handleCloseDialog();
    } catch (error: any) {
      console.error(`${errorMessage}:`, error);
      toast.error(`${errorMessage} ${error?.message ? `(${error.message})` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteThreshold = async () => {
    if (!thresholdToDelete) return;
    setIsSubmitting(true);

    try {
      await deleteTaxRateThreshold(thresholdToDelete.tax_rate_threshold_id);
      toast.success('Tax bracket deleted successfully.');
      await fetchThresholds();
      handleCloseDeleteDialog();
    } catch (error: any) {
      console.error('Failed to delete tax bracket:', error);
      toast.error(`Failed to delete tax bracket. ${error?.message ? `(${error.message})` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate progressive tax for preview amount
  const calculatePreview = useMemo(() => {
    const sortedThresholds = [...thresholds].sort((a, b) => a.min_amount - b.min_amount);
    let remainingAmount = previewAmount;
    let totalTax = 0;
    const breakdown: { min: number; max: number | null; rate: number; taxable: number; tax: number }[] = [];

    for (const threshold of sortedThresholds) {
      if (remainingAmount <= 0) break;

      const bracketMin = threshold.min_amount;
      const bracketMax = threshold.max_amount;
      const rate = threshold.rate;

      // Calculate how much of this bracket applies
      let taxableInBracket: number;
      if (bracketMax === null || bracketMax === undefined) {
        // Unlimited bracket
        taxableInBracket = remainingAmount;
      } else {
        const bracketSize = bracketMax - bracketMin;
        taxableInBracket = Math.min(remainingAmount, bracketSize);
      }

      const bracketTax = (taxableInBracket * rate) / 100;
      totalTax += bracketTax;
      remainingAmount -= taxableInBracket;

      breakdown.push({
        min: bracketMin,
        max: bracketMax ?? null,
        rate,
        taxable: taxableInBracket,
        tax: bracketTax,
      });
    }

    const effectiveRate = previewAmount > 0 ? (totalTax / previewAmount) * 100 : 0;

    return { totalTax, effectiveRate, breakdown };
  }, [thresholds, previewAmount]);

  const formatCurrency = (amount: number) => {
    return `${currency}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const columns: ColumnDefinition<ITaxRateThreshold>[] = [
    {
      title: 'Min Amount',
      dataIndex: 'min_amount',
      render: (value: number) => formatCurrency(value),
    },
    {
      title: 'Max Amount',
      dataIndex: 'max_amount',
      render: (value: number | null | undefined) => value ? formatCurrency(value) : 'No limit',
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      render: (value: number) => `${value}%`,
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '80px',
      render: (_: any, threshold: ITaxRateThreshold) => {
        if (isReadOnly) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                id={`tax-threshold-actions-menu-${threshold.tax_rate_threshold_id}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                disabled={isSubmitting}
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-tax-threshold-${threshold.tax_rate_threshold_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDialog(threshold);
                }}
                disabled={isSubmitting}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`delete-tax-threshold-${threshold.tax_rate_threshold_id}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDeleteDialog(threshold);
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
    <div className="space-y-4" id="tax-threshold-editor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">Progressive Tax Brackets</h4>
          <Tooltip content="Define progressive tax brackets where different rates apply to different portions of the amount. Each bracket applies only to the amount within its range.">
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </div>
        {!isReadOnly && (
          <Button
            size="sm"
            onClick={() => handleOpenDialog()}
            id="add-tax-threshold-button"
            disabled={isSubmitting}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Bracket
          </Button>
        )}
      </div>

      {bracketIssues.length > 0 && (
        <Alert variant="destructive" showIcon={false}>
          <AlertTriangle className="h-4 w-4 absolute left-4 top-4" />
          <AlertDescription>
            <p className="font-medium">Bracket configuration issues:</p>
            <ul className="list-disc list-inside mt-1">
              {bracketIssues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <div className="text-center p-4 text-muted-foreground">Loading brackets...</div>}

      {!isLoading && thresholds.length === 0 && (
        <div className="text-center p-4 text-muted-foreground border border-dashed rounded-lg">
          No tax brackets defined. Add brackets to use progressive taxation.
        </div>
      )}

      {!isLoading && thresholds.length > 0 && (
        <>
          <DataTable
            id="tax-thresholds-table"
            columns={columns}
            data={thresholds}
            onRowClick={isReadOnly ? undefined : (row) => handleOpenDialog(row)}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />

          {/* Progressive Tax Calculation Preview */}
          <div className="bg-muted/50 rounded-lg p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-sm font-medium">Calculation Preview</h5>
              <div className="flex items-center gap-2">
                <Label htmlFor="preview-amount" className="text-sm">Amount:</Label>
                <Input
                  id="preview-amount"
                  type="number"
                  className="w-32 h-8"
                  value={previewAmount}
                  onChange={(e) => setPreviewAmount(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="space-y-1 text-sm">
              {calculatePreview.breakdown.map((item, index) => (
                <div key={index} className="flex justify-between">
                  <span>
                    {formatCurrency(item.min)} - {item.max ? formatCurrency(item.max) : 'above'} @ {item.rate}%:
                  </span>
                  <span>
                    {formatCurrency(item.taxable)} taxable = {formatCurrency(item.tax)}
                  </span>
                </div>
              ))}
              <div className="border-t pt-1 mt-1 flex justify-between font-medium">
                <span>Total Tax:</span>
                <span>{formatCurrency(calculatePreview.totalTax)} (Effective: {calculatePreview.effectiveRate.toFixed(2)}%)</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add/Edit Dialog */}
      <GenericDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        title={editingThreshold ? 'Edit Tax Bracket' : 'Add Tax Bracket'}
        id="tax-threshold-dialog"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-threshold-form">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tax-threshold-min-field">Min Amount *</Label>
              <Controller
                name="min_amount"
                control={form.control}
                render={({ field }) => (
                  <Input
                    id="tax-threshold-min-field"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g., 0"
                    value={field.value}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    disabled={isSubmitting}
                    aria-invalid={form.formState.errors.min_amount ? "true" : "false"}
                  />
                )}
              />
              {form.formState.errors.min_amount && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.min_amount?.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="tax-threshold-max-field">Max Amount (leave empty for no limit)</Label>
              <Controller
                name="max_amount"
                control={form.control}
                render={({ field }) => (
                  <Input
                    id="tax-threshold-max-field"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g., 10000 or empty"
                    value={field.value ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value === '' ? null : parseFloat(value));
                    }}
                    disabled={isSubmitting}
                    aria-invalid={form.formState.errors.max_amount ? "true" : "false"}
                  />
                )}
              />
              {form.formState.errors.max_amount && (
                <p className="text-sm text-red-600" role="alert">
                  {form.formState.errors.max_amount?.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-threshold-rate-field">Rate (%) *</Label>
            <Controller
              name="rate"
              control={form.control}
              render={({ field }) => (
                <Input
                  id="tax-threshold-rate-field"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="e.g., 10"
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

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDialog} id="tax-threshold-dialog-cancel-button">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} id="tax-threshold-dialog-save-button">
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </GenericDialog>

      {/* Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        title="Delete Tax Bracket"
        id="tax-threshold-delete-dialog"
      >
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the bracket {formatCurrency(thresholdToDelete?.min_amount ?? 0)} - {thresholdToDelete?.max_amount ? formatCurrency(thresholdToDelete.max_amount) : 'no limit'}?
            This action cannot be undone.
          </p>
          {thresholds.length <= 1 && (
            <Alert variant="destructive" showIcon={false} className="mt-4">
              <AlertTriangle className="h-4 w-4 absolute left-4 top-4" />
              <AlertDescription>
                Warning: This is the last bracket. Deleting it will disable progressive taxation for this rate.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseDeleteDialog} id="cancel-delete-tax-threshold-button">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteThreshold}
              disabled={isSubmitting}
              id="confirm-delete-tax-threshold-button"
            >
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </GenericDialog>
    </div>
  );
}

export default TaxThresholdEditor;
