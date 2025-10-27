import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';import { Dialog, DialogContent, DialogDescription } from 'server/src/components/ui/Dialog';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getTaxRates, addTaxRate, updateTaxRate, deleteTaxRate, confirmDeleteTaxRate, DeleteTaxRateResult } from '@product/actions/taxRateActions';
import { getActiveTaxRegions } from '@product/actions/taxSettingsActions';
import { ITaxRate, IService } from 'server/src/interfaces/billing.interfaces';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { toPlainDate, parseDateSafe } from 'server/src/lib/utils/dateTimeUtils';
import { Temporal } from '@js-temporal/polyfill';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

const TaxRates: React.FC = () => {
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentTaxRate, setCurrentTaxRate] = useState<Partial<ITaxRate>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
  const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
  const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const [taxRateIdToDelete, setTaxRateIdToDelete] = useState<string | null>(null);
  const [affectedServicesForConfirmation, setAffectedServicesForConfirmation] = useState<Pick<IService, 'service_id' | 'service_name'>[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTaxRates();
    fetchTaxRegions(); // Added
  }, []);

  const fetchTaxRates = async () => {
    setIsLoading(true);
    try {
      const rates = await getTaxRates();
      setTaxRates(rates);
      setError(null);
    } catch (error) {
      console.error('Error fetching tax rates:', error);
      setError('Failed to fetch tax rates');
    } finally {
      setIsLoading(false);
    }
  };

  // Added function to fetch tax regions
  const fetchTaxRegions = async () => {
   try {
       setIsLoadingTaxRegions(true);
       const regions = await getActiveTaxRegions();
       setTaxRegions(regions);
       setErrorTaxRegions(null);
   } catch (error) {
       console.error('Error loading tax regions:', error);
       setErrorTaxRegions('Failed to load tax regions.');
       setTaxRegions([]); // Clear regions on error
   } finally {
       setIsLoadingTaxRegions(false);
   }
  };

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
      errors.push('Tax Region');
    }
    if (!currentTaxRate.tax_percentage) {
      errors.push('Tax percentage');
    }
    if (!currentTaxRate.start_date) {
      errors.push('Start date');
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
      const errorMessage = error.message || `Failed to ${isEditing ? 'update' : 'add'} tax rate`;
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

  const handleDeleteTaxRate = async (taxRateId: string) => {
    setError(null); // Clear previous errors
    try {
      const result: DeleteTaxRateResult = await deleteTaxRate(taxRateId);

      if (result.deleted) {
        await fetchTaxRates();
      } else if (result.affectedServices && result.affectedServices.length > 0) {
        setAffectedServicesForConfirmation(result.affectedServices);
        setTaxRateIdToDelete(taxRateId);
        setIsConfirmDeleteDialogOpen(true);
      } else {
        setError('An unexpected issue occurred while checking for dependencies.');
      }
    } catch (error: any) {
      console.error('Error initiating tax rate deletion:', error);
      setError(error.message || 'Failed to initiate tax rate deletion.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!taxRateIdToDelete) return;

    setError(null);
    try {
      await confirmDeleteTaxRate(taxRateIdToDelete);
      setIsConfirmDeleteDialogOpen(false);
      setTaxRateIdToDelete(null);
      setAffectedServicesForConfirmation([]);
      await fetchTaxRates();
    } catch (error: any) {
      console.error('Error confirming tax rate deletion:', error);
      setError(error.message || 'Failed to confirm tax rate deletion.');
    }
  };


  const columns: ColumnDefinition<ITaxRate>[] = [
    {
      title: 'Region',
      dataIndex: 'region_code', // Changed from region
      render: (value) => taxRegions.find(r => r.region_code === value)?.region_name || value || 'N/A' // Display name or code
    },
    { title: 'Tax Percentage', dataIndex: 'tax_percentage', render: (value) => `${value}%` },
    { title: 'Description', dataIndex: 'description' },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value) => toPlainDate(value).toLocaleString()
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => value ? toPlainDate(value).toLocaleString() : 'N/A'
    },
    {
      title: 'Actions',
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
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-tax-rate-${record.tax_rate_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleEditTaxRate(record);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-tax-rate-${record.tax_rate_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTaxRate(record.tax_rate_id!);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Tax Rates</h3>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
              <span className="block sm:inline">{error || errorTaxRegions}</span> {/* Show either error */}
            </div>
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
              Add New Tax Rate
            </Button>
          </div>
          {isLoading ? (
            <LoadingIndicator
              layout="stacked"
              className="py-10 text-gray-600"
              spinnerProps={{ size: 'md' }}
              text="Loading tax rates"
            />
          ) : (
            <DataTable
              data={taxRates}
              columns={columns}
              onRowClick={handleEditTaxRate}
            />
          )}
        </CardContent>
      </Card>

      <Dialog isOpen={isDialogOpen} onClose={() => {
        setIsDialogOpen(false);
        setHasAttemptedSubmit(false);
        setValidationErrors([]);
      }} title={isEditing ? 'Edit Tax Rate' : 'Add New Tax Rate'}>
        <DialogContent>
          <DialogDescription>Enter the details for the tax rate.</DialogDescription>
          <form onSubmit={(e) => { e.preventDefault(); handleAddOrUpdateTaxRate(); }} noValidate>
            <div className="space-y-4">
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    <p className="font-medium mb-2">Please fill in the required fields:</p>
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
              <Label htmlFor="tax-rate-region-field">Tax Region *</Label>
              <CustomSelect
                id="tax-rate-region-field"
                value={currentTaxRate.region_code || ''}
                onValueChange={(value) => {
                  setCurrentTaxRate({ ...currentTaxRate, region_code: value });
                  setError(null);
                  clearErrorIfSubmitted();
                }}
                options={taxRegions.map(r => ({ value: r.region_code, label: r.region_name }))}
                placeholder={isLoadingTaxRegions ? "Loading regions..." : "Select Tax Region"}
                disabled={isLoadingTaxRegions}
                required={true} // Make region selection required
                className={hasAttemptedSubmit && !currentTaxRate.region_code ? 'ring-1 ring-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-percentage-field">Tax Percentage *</Label>
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
                placeholder="Enter percentage"
                className={hasAttemptedSubmit && !currentTaxRate.tax_percentage ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-description-field">Description</Label>
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
              <Label htmlFor="tax-rate-start-date-field">Start Date *</Label>
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
              <Label htmlFor="tax-rate-end-date-field">End Date (Optional)</Label>
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
            <div className="flex justify-end">
              <Button
              id="save-tax-rate-button"
              type="submit"
              className={!currentTaxRate.region_code || !currentTaxRate.tax_percentage || !currentTaxRate.start_date ? 'opacity-50' : ''}
            >
              {isEditing ? 'Update' : 'Add'} Tax Rate
            </Button>  
            </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Deletion */}
      <Dialog 
        isOpen={isConfirmDeleteDialogOpen} 
        onClose={() => setIsConfirmDeleteDialogOpen(false)}
        title="Confirm Tax Rate Deletion"
      >
        <DialogContent>
          <DialogDescription>
            This tax rate is currently assigned to the following services. Deleting it will remove the tax rate assignment (set to non-taxable) for these services. Are you sure you want to proceed?
          </DialogDescription>
          <div className="my-4 max-h-48 overflow-y-auto">
            <ul className="list-disc pl-5 space-y-1">
              {affectedServicesForConfirmation.map(service => (
                <li key={service.service_id}>{service.service_name}</li>
              ))}
            </ul>
          </div>
          {error && isConfirmDeleteDialogOpen && (
             <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
               <span className="block sm:inline">{error}</span>
             </div>
           )}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsConfirmDeleteDialogOpen(false);
                setError(null);
              }}
              id="cancel-delete-tax-rate-button"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              id="confirm-delete-tax-rate-button"
            >
              Confirm Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaxRates;
