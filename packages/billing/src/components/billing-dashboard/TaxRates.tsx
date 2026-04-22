'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getTaxRates, addTaxRate, updateTaxRate, deleteTaxRate, DeleteTaxRateResult } from '@alga-psa/billing/actions/taxRateActions';
import { getActiveTaxRegions } from '@alga-psa/billing/actions/taxSettingsActions';
import { ITaxRate, DeletionValidationResult } from '@alga-psa/types';
import { ITaxRegion, ITaxRate as FullTaxRate } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { toPlainDate } from '@alga-psa/core';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { MoreVertical, Layers, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { TaxRateDetailPanel } from './TaxRateDetailPanel';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const TaxRates: React.FC = () => {
  const { t } = useTranslation('msp/service-catalog');
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentTaxRate, setCurrentTaxRate] = useState<Partial<ITaxRate>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
  const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
  const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);
  const [taxRateIdToDelete, setTaxRateIdToDelete] = useState<string | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewingTaxRate, setViewingTaxRate] = useState<ITaxRate | null>(null);
  const taxRateToDeleteName = useMemo(() => {
    if (!taxRateIdToDelete) {
      return t('taxRates.deleteEntity.fallback', {
        defaultValue: 'this tax rate',
      });
    }
    const match = taxRates.find((rate) => rate.tax_rate_id === taxRateIdToDelete);
    if (!match) {
      return t('taxRates.deleteEntity.fallback', {
        defaultValue: 'this tax rate',
      });
    }
    const regionName = taxRegions.find((region) => region.region_code === match.region_code)?.region_name;
    return regionName
      ? t('taxRates.deleteEntity.withRegion', {
          regionName,
          defaultValue: '{{regionName}} tax rate',
        })
      : t('taxRates.deleteEntity.fallback', {
          defaultValue: 'this tax rate',
        });
  }, [taxRateIdToDelete, taxRates, taxRegions, t]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const fetchTaxRates = useCallback(async () => {
    setIsLoading(true);
    try {
      const rates = await getTaxRates();
      setTaxRates(rates);
      setError(null);
    } catch (error) {
      console.error('Error fetching tax rates:', error);
      setError(t('taxRates.errors.fetchRates', { defaultValue: 'Failed to fetch tax rates' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // Added function to fetch tax regions
  const fetchTaxRegions = useCallback(async () => {
   try {
       setIsLoadingTaxRegions(true);
       const regions = await getActiveTaxRegions();
       setTaxRegions(regions);
       setErrorTaxRegions(null);
   } catch (error) {
       console.error('Error loading tax regions:', error);
       setErrorTaxRegions(t('taxRates.errors.loadRegions', { defaultValue: 'Failed to load tax regions.' }));
       setTaxRegions([]); // Clear regions on error
   } finally {
       setIsLoadingTaxRegions(false);
   }
  }, [t]);

  useEffect(() => {
    void fetchTaxRates();
    void fetchTaxRegions();
  }, [fetchTaxRates, fetchTaxRegions]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleAddOrUpdateTaxRate = async () => {
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Basic validation - Changed region to region_code
    if (!currentTaxRate.region_code) {
      errors.push(t('taxRates.validation.region', { defaultValue: 'Tax Region' }));
    }
    if (!currentTaxRate.tax_percentage) {
      errors.push(t('taxRates.validation.percentage', { defaultValue: 'Tax percentage' }));
    }
    if (!currentTaxRate.start_date) {
      errors.push(t('taxRates.validation.startDate', { defaultValue: 'Start date' }));
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      setValidationErrors([]);
      if (isEditing) {
        await updateTaxRate(currentTaxRate as ITaxRate);
      } else {
        const newTaxRateWithId: ITaxRate = {
          ...currentTaxRate,
          tax_rate_id: uuidv4(),
        } as ITaxRate;
        await addTaxRate(newTaxRateWithId);
      }
      setIsDialogOpen(false);
      setCurrentTaxRate({}); // Reverted: Clear state
      setIsEditing(false);
      await fetchTaxRates();
      setError(null);
    } catch (error: any) {
      console.error('Error adding/updating tax rate:', error);
      // Extract error message from the server response
      const errorMessage =
        error.message ||
        (isEditing
          ? t('taxRates.errors.update', { defaultValue: 'Failed to update tax rate' })
          : t('taxRates.errors.add', { defaultValue: 'Failed to add tax rate' }));
      setError(errorMessage);
    }
  };

  const formatDateForInput = (date: string | null | undefined): string => {
    if (!date) return '';
    return toPlainDate(date).toString(); // Returns YYYY-MM-DD format
  };

  const handleEditTaxRate = (taxRate: ITaxRate) => {
    // Reverted: No need for tax_percentage_str
    setCurrentTaxRate({
      ...taxRate,
      start_date: formatDateForInput(taxRate.start_date),
      end_date: formatDateForInput(taxRate.end_date)
    });
    setIsEditing(true);
    setIsDialogOpen(true);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const resetDeleteState = () => {
    setTaxRateIdToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async (taxRateId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('tax_rate', taxRateId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate tax rate deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('taxRates.errors.validateDeletion', {
          defaultValue: 'Failed to validate deletion. Please try again.',
        }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [t]);

  const handleDeleteTaxRate = async (taxRateId: string) => {
    setError(null);
    setTaxRateIdToDelete(taxRateId);
    void runDeleteValidation(taxRateId);
  };

  const handleConfirmDelete = async () => {
    if (!taxRateIdToDelete) return;

    setError(null);
    setIsDeleteProcessing(true);
    try {
      const result: DeleteTaxRateResult = await deleteTaxRate(taxRateIdToDelete);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }
      resetDeleteState();
      await fetchTaxRates();
    } catch (error: any) {
      console.error('Error confirming tax rate deletion:', error);
      setError(
        error.message ||
          t('taxRates.errors.confirmDeletion', {
            defaultValue: 'Failed to confirm tax rate deletion.',
          }),
      );
    } finally {
      setIsDeleteProcessing(false);
    }
  };


  const handleViewDetails = (taxRate: ITaxRate) => {
    setViewingTaxRate(taxRate);
  };

  const handleBackToList = async () => {
    setViewingTaxRate(null);
    await fetchTaxRates(); // Refresh the list in case changes were made
  };

  const columns: ColumnDefinition<ITaxRate>[] = [
    {
      title: t('taxRates.table.region', { defaultValue: 'Region' }),
      dataIndex: 'region_code',
      render: (value) =>
        taxRegions.find(r => r.region_code === value)?.region_name ||
        value ||
        t('taxRates.table.notAvailable', { defaultValue: 'N/A' })
    },
    {
      title: t('taxRates.table.taxPercentage', { defaultValue: 'Tax Percentage' }),
      dataIndex: 'tax_percentage',
      render: (value) => `${value}%`
    },
    {
      title: t('taxRates.table.description', { defaultValue: 'Description' }),
      dataIndex: 'description',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {value || '-'}
          {(record as unknown as FullTaxRate).is_composite && (
            <Badge variant="outline" className="text-xs">
              <Layers className="h-3 w-3 mr-1" />
              {t('taxRates.table.composite', { defaultValue: 'Composite' })}
            </Badge>
          )}
        </div>
      )
    },
    {
      title: t('taxRates.table.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      render: (value) => toPlainDate(value).toLocaleString()
    },
    {
      title: t('taxRates.table.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value) =>
        value
          ? toPlainDate(value).toLocaleString()
          : t('taxRates.table.notAvailable', { defaultValue: 'N/A' })
    },
    {
      title: t('taxRates.table.actions', { defaultValue: 'Actions' }),
      dataIndex: 'tax_rate_id',
      width: '5%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`tax-rate-actions-menu-${record.tax_rate_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('taxRates.actions.openMenu', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`view-tax-rate-details-${record.tax_rate_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleViewDetails(record);
              }}
            >
              <Settings className="h-4 w-4 mr-2" />
              {t('taxRates.actions.advancedSettings', {
                defaultValue: 'Advanced Settings',
              })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`edit-tax-rate-${record.tax_rate_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleEditTaxRate(record);
              }}
            >
              {t('taxRates.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-tax-rate-${record.tax_rate_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTaxRate(record.tax_rate_id!);
              }}
            >
              {t('taxRates.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // If viewing a tax rate, show the detail panel
  if (viewingTaxRate) {
    return (
      <div className="space-y-4">
        <TaxRateDetailPanel
          taxRate={viewingTaxRate as unknown as FullTaxRate}
          onBack={handleBackToList}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">
            {t('taxRates.title', { defaultValue: 'Tax Rates' })}
          </h3>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error || errorTaxRegions}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end mb-4">
            <Button
              id="add-tax-rate-button"
              onClick={() => {
                setIsDialogOpen(true);
                setIsEditing(false);
                setCurrentTaxRate({}); // Reverted: Clear state
                setError(null);
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
              }}
            >
              {t('taxRates.actions.addNew', { defaultValue: 'Add New Tax Rate' })}
            </Button>
          </div>
          {isLoading ? (
            <LoadingIndicator
              layout="stacked"
              className="py-10 text-muted-foreground"
              spinnerProps={{ size: 'md' }}
              text={t('taxRates.loading', { defaultValue: 'Loading tax rates' })}
            />
          ) : (
            <DataTable
              id="tax-rates-table"
              data={taxRates}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
              onItemsPerPageChange={handlePageSizeChange}
              onRowClick={handleEditTaxRate}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setHasAttemptedSubmit(false);
          setValidationErrors([]);
        }}
        title={
          isEditing
            ? t('taxRates.dialog.editTitle', { defaultValue: 'Edit Tax Rate' })
            : t('taxRates.dialog.addTitle', { defaultValue: 'Add New Tax Rate' })
        }
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="save-tax-rate-button"
              type="button"
              onClick={() => (document.getElementById('tax-rate-form') as HTMLFormElement | null)?.requestSubmit()}
              className={!currentTaxRate.region_code || !currentTaxRate.tax_percentage || !currentTaxRate.start_date ? 'opacity-50' : ''}
            >
              {isEditing
                ? t('taxRates.actions.update', { defaultValue: 'Update Tax Rate' })
                : t('taxRates.actions.add', { defaultValue: 'Add Tax Rate' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {t('taxRates.dialog.description', {
              defaultValue: 'Enter the details for the tax rate.',
            })}
          </DialogDescription>
          <form id="tax-rate-form" onSubmit={(e) => { e.preventDefault(); handleAddOrUpdateTaxRate(); }} noValidate>
            <div className="space-y-4">
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    <p className="font-medium mb-2">
                      {t('taxRates.validation.requiredFieldsTitle', {
                        defaultValue: 'Please fill in the required fields:',
                      })}
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      {validationErrors.map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            {/* Replaced Input with CustomSelect for Region */}
            <div>
              <Label htmlFor="tax-rate-region-field">
                {t('taxRates.dialog.fields.region', { defaultValue: 'Tax Region *' })}
              </Label>
              <CustomSelect
                id="tax-rate-region-field"
                value={currentTaxRate.region_code || ''}
                onValueChange={(value) => {
                  setCurrentTaxRate({ ...currentTaxRate, region_code: value });
                  setError(null);
                  clearErrorIfSubmitted();
                }}
                options={taxRegions.map(r => ({ value: r.region_code, label: r.region_name }))}
                placeholder={
                  isLoadingTaxRegions
                    ? t('taxRates.dialog.placeholders.loadingRegions', {
                        defaultValue: 'Loading regions...',
                      })
                    : t('taxRates.dialog.placeholders.selectRegion', {
                        defaultValue: 'Select Tax Region',
                      })
                }
                disabled={isLoadingTaxRegions}
                required={true} // Make region selection required
                className={hasAttemptedSubmit && !currentTaxRate.region_code ? 'ring-1 ring-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-percentage-field">
                {t('taxRates.dialog.fields.percentage', {
                  defaultValue: 'Tax Percentage *',
                })}
              </Label>
              <Input
                id="tax-rate-percentage-field"
                type="number"
                // Keep step removed, but revert onChange logic
                value={currentTaxRate.tax_percentage || ''}
                onChange={(e) => {
                  // Reverted: Parse float directly into state
                  setCurrentTaxRate({ ...currentTaxRate, tax_percentage: parseFloat(e.target.value) });
                  setError(null);
                  clearErrorIfSubmitted();
                }}
                placeholder={t('taxRates.dialog.placeholders.percentage', {
                  defaultValue: 'Enter percentage',
                })}
                className={hasAttemptedSubmit && !currentTaxRate.tax_percentage ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-description-field">
                {t('taxRates.dialog.fields.description', { defaultValue: 'Description' })}
              </Label>
              <Input
                id="tax-rate-description-field"
                value={currentTaxRate.description || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, description: e.target.value });
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-start-date-field">
                {t('taxRates.dialog.fields.startDate', { defaultValue: 'Start Date *' })}
              </Label>
              <Input
                id="tax-rate-start-date-field"
                type="date"
                value={currentTaxRate.start_date || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, start_date: e.target.value });
                  setError(null);
                  clearErrorIfSubmitted();
                }}
                className={hasAttemptedSubmit && !currentTaxRate.start_date ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-end-date-field">
                {t('taxRates.dialog.fields.endDate', {
                  defaultValue: 'End Date (Optional)',
                })}
              </Label>
              <Input
                id="tax-rate-end-date-field"
                type="date"
                value={currentTaxRate.end_date || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, end_date: e.target.value || null });
                  setError(null);
                }}
              />
            </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteEntityDialog
        id="delete-tax-rate-dialog"
        isOpen={Boolean(taxRateIdToDelete)}
        onClose={resetDeleteState}
        onConfirmDelete={handleConfirmDelete}
        entityName={taxRateToDeleteName}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </div>
  );
};

export default TaxRates;
