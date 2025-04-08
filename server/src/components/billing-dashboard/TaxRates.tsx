import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from 'server/src/components/ui/Dialog';
import { Label } from 'server/src/components/ui/Label';
import { getTaxRates, addTaxRate, updateTaxRate, deleteTaxRate } from 'server/src/lib/actions/taxRateActions';
import { ITaxRate } from 'server/src/interfaces/billing.interfaces';
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

const TaxRates: React.FC = () => {
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentTaxRate, setCurrentTaxRate] = useState<Partial<ITaxRate>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTaxRates();
  }, []);

  const fetchTaxRates = async () => {
    try {
      const rates = await getTaxRates();
      setTaxRates(rates);
      setError(null);
    } catch (error) {
      console.error('Error fetching tax rates:', error);
      setError('Failed to fetch tax rates');
    }
  };

  const handleAddOrUpdateTaxRate = async () => {
    // Basic validation
    if (!currentTaxRate.region) {
      setError('Region is required');
      return;
    }
    if (!currentTaxRate.tax_percentage) {
      setError('Tax percentage is required');
      return;
    }
    if (!currentTaxRate.start_date) {
      setError('Start date is required');
      return;
    }

    try {
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
      setCurrentTaxRate({});
      setIsEditing(false);
      fetchTaxRates();
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
    setCurrentTaxRate({
      ...taxRate,
      start_date: formatDateForInput(taxRate.start_date),
      end_date: formatDateForInput(taxRate.end_date)
    });
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  const handleDeleteTaxRate = async (taxRateId: string) => {
    if (window.confirm('Are you sure you want to delete this tax rate?')) {
      try {
        await deleteTaxRate(taxRateId);
        fetchTaxRates();
        setError(null);
      } catch (error) {
        console.error('Error deleting tax rate:', error);
        setError('Failed to delete tax rate');
      }
    }
  };

  const columns: ColumnDefinition<ITaxRate>[] = [
    { title: 'Region', dataIndex: 'region' },
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
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          <div className="flex justify-end mb-4">
            <Button
              id="add-tax-rate-button"
              onClick={() => {
                setIsDialogOpen(true);
                setIsEditing(false);
                setCurrentTaxRate({});
                setError(null);
              }}
            >
              Add New Tax Rate
            </Button>
          </div>
          <DataTable
            data={taxRates}
            columns={columns}
            onRowClick={handleEditTaxRate}
          />
        </CardContent>
      </Card>

      <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Tax Rate' : 'Add New Tax Rate'}</DialogTitle>
            <DialogDescription>Enter the details for the tax rate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tax-rate-region-field">Region</Label>
              <Input
                id="tax-rate-region-field"
                value={currentTaxRate.region || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, region: e.target.value });
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-percentage-field">Tax Percentage</Label>
              <Input
                id="tax-rate-percentage-field"
                type="number"
                step="0.01"
                value={currentTaxRate.tax_percentage || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, tax_percentage: parseFloat(e.target.value) });
                  setError(null);
                }}
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
              <Label htmlFor="tax-rate-start-date-field">Start Date</Label>
              <Input
                id="tax-rate-start-date-field"
                type="date"
                value={currentTaxRate.start_date || ''}
                onChange={(e) => {
                  setCurrentTaxRate({ ...currentTaxRate, start_date: e.target.value });
                  setError(null);
                }}
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
            <Button
              id="save-tax-rate-button"
              onClick={handleAddOrUpdateTaxRate}
            >
              {isEditing ? 'Update' : 'Add'} Tax Rate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaxRates;
