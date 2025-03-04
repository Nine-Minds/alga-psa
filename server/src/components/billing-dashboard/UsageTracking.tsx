'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Plus } from 'lucide-react';
import { useToast } from 'server/src/hooks/use-toast';
import { IUsageRecord, ICreateUsageRecord, IUsageFilter } from 'server/src/interfaces/usage.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { createUsageRecord, deleteUsageRecord, getUsageRecords, updateUsageRecord } from 'server/src/lib/actions/usageActions';
import { getAllCompanies } from 'server/src/lib/actions/companyActions';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';

interface UsageTrackingProps {
  initialServices: IService[];
}

const UsageTracking: React.FC<UsageTrackingProps> = ({ initialServices }) => {
  const { toast } = useToast();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [usageRecords, setUsageRecords] = useState<IUsageRecord[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string>('');
  const [editingUsage, setEditingUsage] = useState<IUsageRecord | null>(null);
  const [usageToDelete, setUsageToDelete] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [newUsage, setNewUsage] = useState<ICreateUsageRecord>({
    company_id: '',
    service_id: '',
    quantity: 0,
    usage_date: new Date().toISOString(),
  });

  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    type: 'container',
    id: 'usage-tracking',
    label: 'Usage Tracking'
  });

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    loadUsageRecords();
  }, [selectedCompany, selectedService]);

  const loadCompanies = async () => {
    try {
      const fetchedCompanies = await getAllCompanies();
      setCompanies(fetchedCompanies);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load companies",
        variant: "destructive",
      });
    }
  };

  const loadUsageRecords = async () => {
    try {
      setIsLoading(true);
      const filter: IUsageFilter = {};
      if (selectedCompany !== null) filter.company_id = selectedCompany;
      if (selectedService) filter.service_id = selectedService;
      
      const records = await getUsageRecords(filter);
      setUsageRecords(records);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load usage records",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUsage = async () => {
    try {
      setIsSaving(true);
      await createUsageRecord(newUsage);
      setIsAddModalOpen(false);
      loadUsageRecords();
      toast({
        title: "Success",
        description: "Usage record created successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create usage record",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditUsage = async () => {
    if (!editingUsage) return;
    
    try {
      setIsSaving(true);
      await updateUsageRecord({
        usage_id: editingUsage.usage_id,
        ...newUsage,
      });
      setEditingUsage(null);
      loadUsageRecords();
      toast({
        title: "Success",
        description: "Usage record updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update usage record",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUsage = async (usageId: string) => {
    setUsageToDelete(usageId);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteUsage = async () => {
    if (!usageToDelete) return;

    try {
      setIsSaving(true);
      await deleteUsageRecord(usageToDelete);
      loadUsageRecords();
      toast({
        title: "Success",
        description: "Usage record deleted successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete usage record",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
      setIsDeleteDialogOpen(false);
      setUsageToDelete(null);
    }
  };

  const resetForm = () => {
    setNewUsage({
      company_id: '',
      service_id: '',
      quantity: 0,
      usage_date: new Date().toISOString(),
    });
    setEditingUsage(null);
  };

  const columns: ColumnDefinition<IUsageRecord>[] = [
    {
      title: 'Company',
      dataIndex: 'company_name',
    },
    {
      title: 'Service',
      dataIndex: 'service_name',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
    },
    {
      title: 'Usage Date',
      dataIndex: 'usage_date',
      render: (value) => new Date(value).toLocaleDateString(),
    },
    {
      title: 'Actions',
      dataIndex: 'usage_id',
      render: (_, record) => (
        <div className="space-x-2">
          <Button
            id={`edit-usage-${record.usage_id}`}
            variant="default"
            onClick={() => {
              setEditingUsage(record);
              setNewUsage({
                company_id: record.company_id,
                service_id: record.service_id,
                quantity: record.quantity,
                usage_date: record.usage_date,
              });
              setIsAddModalOpen(true);
            }}
            disabled={isSaving}
          >
            Edit
          </Button>
          <Button
            id={`delete-usage-${record.usage_id}`}
            variant="destructive"
            onClick={() => handleDeleteUsage(record.usage_id)}
            disabled={isSaving}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ReflectionContainer {...containerProps}>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Usage Tracking</h3>
            <Button
              id="add-usage-button"
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-2"
              disabled={isSaving}
            >
              <Plus className="h-4 w-4" />
              Add Usage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="company-filter">Company</Label>
                <CompanyPicker
                  id="company-filter"
                  companies={companies}
                  selectedCompanyId={selectedCompany}
                  onSelect={setSelectedCompany}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="service-filter">Service</Label>
                <CustomSelect
                  id="service-filter"
                  value={selectedService}
                  onValueChange={setSelectedService}
                  placeholder="Filter by service"
                  options={initialServices.map(service => ({
                    label: service.service_name,
                    value: service.service_id
                  }))}
                />
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : (
              <DataTable
                data={usageRecords}
                columns={columns}
                pagination={true}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
        id="usage-form-dialog"
        title={editingUsage ? 'Edit Usage Record' : 'Add Usage Record'}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUsage ? 'Edit Usage Record' : 'Add Usage Record'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="company-select">Company</Label>
              <CompanyPicker
                id="company-select"
                companies={companies}
                selectedCompanyId={newUsage.company_id}
                onSelect={(id) => setNewUsage({ ...newUsage, company_id: id || '' })}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
              />
            </div>
            <div>
              <Label htmlFor="service-select">Service</Label>
              <CustomSelect
                id="service-select"
                value={newUsage.service_id}
                onValueChange={(value: string) => setNewUsage({ ...newUsage, service_id: value })}
                placeholder="Select service"
                options={initialServices.map(service => ({
                  label: service.service_name,
                  value: service.service_id
                }))}
              />
            </div>
            <div>
              <Label htmlFor="quantity-input">Quantity</Label>
              <Input
                id="quantity-input"
                type="number"
                value={newUsage.quantity}
                onChange={(e) => setNewUsage({ ...newUsage, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="usage-date-input">Usage Date</Label>
              <Input
                id="usage-date-input"
                type="date"
                value={newUsage.usage_date.toString().split('T')[0]}
                onChange={(e) => setNewUsage({ ...newUsage, usage_date: new Date(e.target.value).toISOString() })}
              />
            </div>
            <div>
              <Label htmlFor="comments-input">Comments (Optional)</Label>
              <Input
                id="comments-input"
                type="text"
                onChange={(e) => setNewUsage({ ...newUsage, comments: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button 
                id="cancel-usage-button"
                variant="outline" 
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button 
                id="submit-usage-button"
                onClick={editingUsage ? handleEditUsage : handleAddUsage}
                disabled={isSaving}
              >
                {editingUsage ? 'Update' : 'Add'} Usage
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteUsage}
        title="Delete Usage Record"
        message="Are you sure you want to delete this usage record? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </ReflectionContainer>
  );
};

export default UsageTracking;
