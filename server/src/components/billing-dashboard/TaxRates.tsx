import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/Dialog';
import { Label } from '@/components/ui/Label';
import { getTaxRates, addTaxRate, updateTaxRate, deleteTaxRate } from '@/lib/actions/taxRateActions';
import { ITaxRate } from '@/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

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
    try {
      if (isEditing) {
        await updateTaxRate('', currentTaxRate as ITaxRate);
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
    } catch (error) {
      console.error('Error adding/updating tax rate:', error);
      setError(`Failed to ${isEditing ? 'update' : 'add'} tax rate`);
    }
  };

  const handleEditTaxRate = (taxRate: ITaxRate) => {
    setCurrentTaxRate(taxRate);
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
      render: (value) => new Date(value).toLocaleDateString() 
    },
    { 
      title: 'End Date', 
      dataIndex: 'end_date', 
      render: (value) => value ? new Date(value).toLocaleDateString() : 'N/A' 
    },
    {
      title: 'Actions',
      dataIndex: 'tax_rate_id',
      render: (_, record) => (
        <>
          <Button id={`edit-tax-rate-${record.tax_rate_id}`} onClick={() => handleEditTaxRate(record)} className="mr-2">Edit</Button>
          <Button id={`delete-tax-rate-${record.tax_rate_id}`} onClick={() => handleDeleteTaxRate(record.tax_rate_id!)}>Delete</Button>
        </>
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
          <Button id="add-tax-rate-btn" onClick={() => { setIsDialogOpen(true); setIsEditing(false); setCurrentTaxRate({}); }}>Add New Tax Rate</Button>
          <DataTable
            data={taxRates}
            columns={columns}
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
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
                value={currentTaxRate.region || ''}
                onChange={(e) => setCurrentTaxRate({ ...currentTaxRate, region: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="taxPercentage">Tax Percentage</Label>
              <Input
                id="taxPercentage"
                type="number"
                step="0.01"
                value={currentTaxRate.tax_percentage || ''}
                onChange={(e) => setCurrentTaxRate({ ...currentTaxRate, tax_percentage: parseFloat(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={currentTaxRate.description || ''}
                onChange={(e) => setCurrentTaxRate({ ...currentTaxRate, description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={currentTaxRate.start_date || ''}
                onChange={(e) => setCurrentTaxRate({ ...currentTaxRate, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="endDate">End Date (Optional)</Label>
              <Input
                id="endDate"
                type="date"
                value={currentTaxRate.end_date || ''}
                onChange={(e) => setCurrentTaxRate({ ...currentTaxRate, end_date: e.target.value || null })}
              />
            </div>
            <Button id="save-tax-rate-btn" onClick={handleAddOrUpdateTaxRate}>{isEditing ? 'Update' : 'Add'} Tax Rate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaxRates;
