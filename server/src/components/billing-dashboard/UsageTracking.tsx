'use client';

import React, { useState, useEffect } from 'react';
import { getEligibleContractLinesForUI } from 'server/src/lib/utils/contractLineDisambiguation';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Plus, AlertTriangle, Info, MoreVertical, Package } from 'lucide-react';
import { useToast } from 'server/src/hooks/use-toast';
import { IUsageRecord, ICreateUsageRecord, IUsageFilter } from 'server/src/interfaces/usage.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { createUsageRecord, deleteUsageRecord, getUsageRecords, updateUsageRecord } from 'server/src/lib/actions/usageActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { ClientPicker } from "server/src/components/clients/ClientPicker";
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { getRemainingBucketUnits, RemainingBucketUnitsResult } from 'server/src/lib/actions/report-actions';
import BucketUsageChart from './BucketUsageChart';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

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
  const [clients, setClients] = useState<IClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string>('');
  const [editingUsage, setEditingUsage] = useState<IUsageRecord | null>(null);
  const [usageToDelete, setUsageToDelete] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [newUsage, setNewUsage] = useState<ICreateUsageRecord>({
    client_id: '',
    service_id: '',
    quantity: 0,
    usage_date: new Date().toISOString(),
  });
  const [eligibleContractLines, setEligibleContractLines] = useState<Array<{
    client_contract_line_id: string;
    contract_line_name: string;
    contract_line_type: string;
    start_date: string;
    end_date: string | null;
    has_bucket_overlay: boolean;
  }>>([]);
  const [showContractLineSelector, setShowContractLineSelector] = useState(false);
  type BucketUsageData = RemainingBucketUnitsResult & { plan_id: string; plan_name: string };
  const [bucketData, setBucketData] = useState<BucketUsageData[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);

  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    type: 'container',
    id: 'usage-tracking',
    label: 'Usage Tracking'
  });

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    loadUsageRecords();
  }, [selectedClient, selectedService]);

  useEffect(() => {
    if (selectedClient && selectedClient !== 'all_clients') {
      loadBucketUsageForClient(selectedClient);
    } else {
      // No client selected; clear bucket view
      setBucketData([]);
      setLoadingBuckets(false);
    }
  }, [selectedClient]);

  // Load eligible contract lines when client and service change in the form
  useEffect(() => {
    const loadEligibleContractLines = async () => {
      if (!newUsage.client_id || !newUsage.service_id) {
        setEligibleContractLines([]);
        setShowContractLineSelector(false);
        return;
      }

      try {
        const plans = await getEligibleContractLinesForUI(newUsage.client_id, newUsage.service_id);
        setEligibleContractLines(plans);

        // Always show the contract line selector, but set a default when appropriate
        setShowContractLineSelector(true);

        // If no contract line is selected yet, try to set a default
        if (!newUsage.contract_line_id) {
          if (plans.length === 1) {
            // If there's only one contract line, use it automatically
            setNewUsage(prev => ({ ...prev, contract_line_id: plans[0].client_contract_line_id }));
          } else if (plans.length > 1) {
            // Prefer the single contract line that has a bucket overlay (if any)
            const overlayPlans = plans.filter(plan => plan.has_bucket_overlay);
            if (overlayPlans.length === 1) {
              setNewUsage(prev => ({ ...prev, contract_line_id: overlayPlans[0].client_contract_line_id }));
            }
          }
        } else if (plans.length === 0) {
          // Clear any existing contract line selection if no contract lines are available
          setNewUsage(prev => ({ ...prev, contract_line_id: undefined }));
        }
      } catch (error) {
        console.error('Error loading eligible contract lines:', error);
      }
    };

    loadEligibleContractLines();
  }, [newUsage.client_id, newUsage.service_id]);

  const loadClients = async () => {
    try {
      const fetchedClients = await getAllClients();
      setClients(fetchedClients);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load clients",
        variant: "destructive",
      });
    }
  };

  const loadBucketUsageForClient = async (clientId: string) => {
    try {
      setLoadingBuckets(true);
      const currentDate = new Date().toISOString().split('T')[0];
      const buckets = await getRemainingBucketUnits({ clientId, currentDate });
      // Map to chart's expected shape
      const mapped: BucketUsageData[] = buckets.map(b => ({
        ...b,
        plan_id: b.contract_line_id,
        plan_name: b.contract_line_name,
      }));
      setBucketData(mapped);
    } catch (error) {
      console.error('Error loading bucket usage:', error);
    } finally {
      setLoadingBuckets(false);
    }
  };

  const loadUsageRecords = async () => {
    try {
      setIsLoading(true);
      const filter: IUsageFilter = {};
      if (selectedClient !== null && selectedClient !== 'all_clients') filter.client_id = selectedClient;
      if (selectedService && selectedService !== 'all_services') filter.service_id = selectedService;

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
      client_id: '',
      service_id: '',
      quantity: 0,
      usage_date: new Date().toISOString(),
      contract_line_id: undefined,
    });
    setEditingUsage(null);
    setEligibleContractLines([]);
    setShowContractLineSelector(false);
  };

  const columns: ColumnDefinition<IUsageRecord>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
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
      title: 'Contract Line',
      dataIndex: 'contract_line_id',
      render: (value, record) => {
        // This would ideally be populated from a join in the backend
        // For now, we'll just show the ID or "Default"
        return value ? `Contract Line: ${value.substring(0, 8)}...` : "Default Contract Line";
      },
    },
    {
      title: 'Actions',
      dataIndex: 'usage_id',
      width: '5%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`usage-actions-menu-${record.usage_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-usage-${record.usage_id}`}
              onClick={() => {
                setEditingUsage(record);
                setNewUsage({
                  client_id: record.client_id,
                  service_id: record.service_id,
                  quantity: record.quantity,
                  usage_date: record.usage_date,
                  contract_line_id: record.contract_line_id,
                });
                setIsAddModalOpen(true);
              }}
              disabled={isSaving}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-usage-${record.usage_id}`}
              onClick={() => handleDeleteUsage(record.usage_id)}
              disabled={isSaving}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <ReflectionContainer {...containerProps}>
      {/* Bucket Usage Overview */}
      {(loadingBuckets || bucketData.length > 0) && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center">
              <Package className="h-5 w-5 text-blue-600 mr-2" />
              <h3 className="text-lg font-semibold">Bucket Hours Overview</h3>
            </div>
          </CardHeader>
          <CardContent>
            {loadingBuckets ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ) : bucketData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {bucketData.map((bucket) => (
                  <BucketUsageChart
                    key={`${bucket.plan_id}-${bucket.service_id}`}
                    bucketData={bucket}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No active bucket plans found.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage Records Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Usage Records</h3>
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
            <div className="flex items-center space-x-2 mb-4">
              <div className="flex-1">
                <Label htmlFor="client-filter">Client</Label>
                <CustomSelect
                  id="client-filter"
                  value={selectedClient || 'all_clients'}
                  onValueChange={value => setSelectedClient(value === 'all_clients' ? null : value)}
                  placeholder="Filter by client"
                  options={[
                    { value: 'all_clients', label: 'All Clients' },
                    ...clients.map(client => ({
                      value: client.client_id,
                      label: client.client_name
                    }))
                  ]}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="service-filter">Service</Label>
                <CustomSelect
                  id="service-filter"
                  value={selectedService || 'all_services'}
                  onValueChange={value => setSelectedService(value === 'all_services' ? '' : value)}
                  placeholder="Filter by service"
                  options={[
                    { value: 'all_services', label: 'All Services' },
                    ...initialServices.map(service => ({
                      label: service.service_name,
                      value: service.service_id
                    }))
                  ]}
                />
              </div>
              <div className="flex items-end">
                <Button
                  id="clear-filters-button"
                  variant="outline"
                  onClick={() => {
                    setSelectedService('all_services');
                    setSelectedClient('all_clients');
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>

            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-gray-600"
                spinnerProps={{ size: 'md' }}
                text="Loading usage records"
              />
            ) : (
              <DataTable
                id="usage-tracking-table"
                data={usageRecords}
                columns={columns}
                pagination={true}
                onRowClick={(record) => {
                  setEditingUsage(record);
                  setNewUsage({
                    client_id: record.client_id,
                    service_id: record.service_id,
                    quantity: record.quantity,
                    usage_date: record.usage_date,
                    contract_line_id: record.contract_line_id,
                  });
                  setIsAddModalOpen(true);
                }}
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
          <div className="space-y-4">
            <div>
              <Label htmlFor="client-select">Client</Label>
              <ClientPicker
                id="client-select"
                clients={clients}
                selectedClientId={newUsage.client_id}
                onSelect={(id) => setNewUsage({ ...newUsage, client_id: id || '' })}
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
                options={initialServices
                  .filter(service => service.billing_method === 'usage')
                  .map(service => ({
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
                value={newUsage.usage_date
                  ? new Date(newUsage.usage_date).toISOString().split('T')[0]
                  : ''}
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

            {/* Contract Line Selector with enhanced guidance */}
            {showContractLineSelector && (
              <div>
                {eligibleContractLines.length > 1 && (
                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-md mb-2">
                    <div className="flex items-center">
                      <Info className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                      <p className="text-sm text-blue-700">
                        This service appears in multiple contract lines. Please select which contract line to bill against.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-1">
                  <label className={`block text-sm font-medium ${eligibleContractLines.length > 1 ? 'text-blue-700' : 'text-gray-700'}`}>
                    Contract Line <span className="text-red-500">*</span>
                  </label>
                  <div className="relative inline-block">
                    <div
                      className="cursor-help"
                      title={!newUsage.client_id
                        ? "Client information not available. The system will use the default contract line."
                        : eligibleContractLines.length > 1
                          ? "This service appears in multiple contract lines. Please select which contract line to use. Bucket contract lines are typically used first until depleted."
                          : eligibleContractLines.length === 1
                            ? `This usage will be billed under the "${eligibleContractLines[0].contract_line_name}" contract line.`
                            : "No eligible contract lines found for this service."}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-gray-500">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 16v-4M12 8h.01"></path>
                      </svg>
                    </div>
                  </div>
                </div>

                <CustomSelect
                  id="contract-line-select"
                  value={newUsage.contract_line_id || ''}
                  onValueChange={(value: string) => setNewUsage({ ...newUsage, contract_line_id: value })}
                  disabled={!newUsage.client_id || eligibleContractLines.length <= 1}
                  className={`${eligibleContractLines.length > 1 ? 'border-blue-300 focus:border-blue-500 focus:ring-blue-500' : ''}`}
                  placeholder={!newUsage.client_id
                    ? "Using default contract line"
                    : eligibleContractLines.length === 0
                      ? "No eligible contract lines"
                      : eligibleContractLines.length === 1
                        ? `Using ${eligibleContractLines[0].contract_line_name}`
                        : "Select a contract line"}
                  options={eligibleContractLines.map(plan => ({
                    value: plan.client_contract_line_id,
                    label: `${plan.contract_line_name} (${plan.contract_line_type})`
                  }))}
                />

                {eligibleContractLines.length > 1 && (
                  <div className="mt-1 text-xs text-gray-600">
                    <span className="flex items-center">
                      <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                      Selecting the wrong contract line may result in incorrect billing
                    </span>
                  </div>
                )}

                {!newUsage.client_id ? (
                  <small className="text-gray-500 mt-1">
                    Client information not available. The system will use the default contract line.
                  </small>
                ) : eligibleContractLines.length === 0 ? (
                  <small className="text-gray-500 mt-1">
                    No eligible contract lines found for this service.
                  </small>
                ) : <></>}
              </div>
            )}
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
