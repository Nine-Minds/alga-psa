'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getEligibleContractLinesForUI } from '@alga-psa/billing/lib/contractLineDisambiguation';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, AlertTriangle, Info, MoreVertical, Package } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { IUsageRecord, ICreateUsageRecord, IUsageFilter } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { createUsageRecord, deleteUsageRecord, getUsageRecords, updateUsageRecord } from '../../actions/usageActions';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { getRemainingBucketUnits, type RemainingBucketUnitsResult } from '@alga-psa/reporting/actions';
import BucketUsageChart from '@alga-psa/ui/components/charts/BucketUsageChart';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface UsageTrackingProps {
  initialServices: IService[];
}

const UsageTracking: React.FC<UsageTrackingProps> = ({ initialServices }) => {
  const { t } = useTranslation('msp/billing');
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const usageServiceOptions = useMemo(
    () =>
      initialServices
        .filter((service) => service.item_kind !== 'product')
        .map((service) => ({
          label: service.service_name,
          value: service.service_id,
        })),
    [initialServices],
  );

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

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
        const plans = await getEligibleContractLinesForUI(
          newUsage.client_id,
          newUsage.service_id,
          newUsage.usage_date
        );
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
      const fetchedClients = await getAllClientsForBilling();
      setClients(fetchedClients);
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.loadClientsError', { defaultValue: 'Failed to load clients' }),
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
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.loadUsageError', { defaultValue: 'Failed to load usage records' }),
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
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.createSuccess', { defaultValue: 'Usage record created successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.createError', { defaultValue: 'Failed to create usage record' }),
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
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.updateSuccess', { defaultValue: 'Usage record updated successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.updateError', { defaultValue: 'Failed to update usage record' }),
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
        title: t('common.success', { defaultValue: 'Success' }),
        description: t('usage.toast.deleteSuccess', { defaultValue: 'Usage record deleted successfully' }),
      });
    } catch (error) {
      toast({
        title: t('common.error', { defaultValue: 'Error' }),
        description: t('usage.toast.deleteError', { defaultValue: 'Failed to delete usage record' }),
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
      title: t('usage.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
    },
    {
      title: t('usage.table.service', { defaultValue: 'Service' }),
      dataIndex: 'service_name',
    },
    {
      title: t('usage.table.quantity', { defaultValue: 'Quantity' }),
      dataIndex: 'quantity',
    },
    {
      title: t('usage.table.usageDate', { defaultValue: 'Usage Date' }),
      dataIndex: 'usage_date',
      render: (value) => new Date(value).toLocaleDateString(),
    },
    {
      title: t('usage.table.contractLine', { defaultValue: 'Contract Line' }),
      dataIndex: 'contract_line_id',
      render: (value, record) => {
        // This would ideally be populated from a join in the backend
        // For now, we'll just show the ID or "Default"
        return value
          ? t('usage.table.contractLineLabel', { defaultValue: 'Contract Line: {{id}}...', id: value.substring(0, 8) })
          : t('usage.table.defaultContractLine', { defaultValue: 'Default Contract Line' });
      },
    },
    {
      title: t('usage.table.actions', { defaultValue: 'Actions' }),
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
              <span className="sr-only">{t('common.openMenu', { defaultValue: 'Open menu' })}</span>
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
              {t('usage.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-usage-${record.usage_id}`}
              onClick={() => handleDeleteUsage(record.usage_id)}
              disabled={isSaving}
            >
              {t('usage.actions.delete', { defaultValue: 'Delete' })}
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
              <h3 className="text-lg font-semibold">{t('usage.bucketHoursOverview', { defaultValue: 'Bucket Hours Overview' })}</h3>
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
              <p className="text-sm text-muted-foreground">{t('usage.states.noActiveBucketPlans', { defaultValue: 'No active bucket plans found.' })}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage Records Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">{t('usage.usageRecords', { defaultValue: 'Usage Records' })}</h3>
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
              {t('usage.actions.addUsage', { defaultValue: 'Add Usage' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center space-x-2 mb-4">
              <div className="flex-1">
                <Label htmlFor="client-filter">{t('usage.filters.client', { defaultValue: 'Client' })}</Label>
                <CustomSelect
                  id="client-filter"
                  value={selectedClient || 'all_clients'}
                  onValueChange={value => setSelectedClient(value === 'all_clients' ? null : value)}
                  placeholder={t('usage.filters.clientPlaceholder', { defaultValue: 'Filter by client' })}
                  options={[
                    { value: 'all_clients', label: t('usage.filters.allClients', { defaultValue: 'All Clients' }) },
                    ...clients.map(client => ({
                      value: client.client_id,
                      label: client.client_name
                    }))
                  ]}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="service-filter">{t('usage.filters.service', { defaultValue: 'Service' })}</Label>
                <CustomSelect
                  id="service-filter"
                  value={selectedService || 'all_services'}
                  onValueChange={value => setSelectedService(value === 'all_services' ? '' : value)}
                  placeholder={t('usage.filters.servicePlaceholder', { defaultValue: 'Filter by service' })}
                  options={[
                    { value: 'all_services', label: t('usage.filters.allServices', { defaultValue: 'All Services' }) },
                    ...usageServiceOptions,
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
                  {t('usage.actions.resetFilters', { defaultValue: 'Reset' })}
                </Button>
              </div>
            </div>

            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-muted-foreground"
                spinnerProps={{ size: 'md' }}
                text={t('usage.states.loadingRecords', { defaultValue: 'Loading usage records' })}
              />
            ) : (
              <DataTable
                id="usage-tracking-table"
                data={usageRecords}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
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
        title={editingUsage
          ? t('usage.dialog.editTitle', { defaultValue: 'Edit Usage Record' })
          : t('usage.dialog.addTitle', { defaultValue: 'Add Usage Record' })}
        disableFocusTrap
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-usage-button"
              variant="outline"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSaving}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="submit-usage-button"
              onClick={editingUsage ? handleEditUsage : handleAddUsage}
              disabled={isSaving}
            >
              {editingUsage
                ? t('usage.actions.updateUsage', { defaultValue: 'Update Usage' })
                : t('usage.actions.addUsage', { defaultValue: 'Add Usage' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="client-select">{t('usage.dialog.fields.client', { defaultValue: 'Client' })}</Label>
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
              <Label htmlFor="service-select">{t('usage.dialog.fields.service', { defaultValue: 'Service' })}</Label>
              <CustomSelect
                id="service-select"
                value={newUsage.service_id}
                onValueChange={(value: string) => setNewUsage({ ...newUsage, service_id: value })}
                placeholder={t('usage.dialog.servicePlaceholder', { defaultValue: 'Select service' })}
                options={usageServiceOptions}
              />
            </div>
            <div>
              <Label htmlFor="quantity-input">{t('usage.dialog.fields.quantity', { defaultValue: 'Quantity' })}</Label>
              <Input
                id="quantity-input"
                type="number"
                value={newUsage.quantity}
                onChange={(e) => setNewUsage({ ...newUsage, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="usage-date-input">{t('usage.dialog.fields.usageDate', { defaultValue: 'Usage Date' })}</Label>
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
              <Label htmlFor="comments-input">{t('usage.dialog.fields.comments', { defaultValue: 'Comments (Optional)' })}</Label>
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
                  <Alert variant="info" className="mb-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      {t('usage.contractLineGuidance.multipleLines', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to bill against.' })}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex items-center space-x-1">
                  <label className={`block text-sm font-medium ${eligibleContractLines.length > 1 ? 'text-blue-700' : 'text-[rgb(var(--color-text-700))]'}`}>
                    {t('usage.dialog.fields.contractLine', { defaultValue: 'Contract Line' })} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative inline-block">
                    <div
                      className="cursor-help"
                      title={!newUsage.client_id
                        ? t('usage.contractLineGuidance.tooltipNoClient', { defaultValue: 'Client information not available. Usage will route to the system-managed default contract.' })
                        : eligibleContractLines.length > 1
                          ? t('usage.contractLineGuidance.tooltipMultiple', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to use. Bucket contract lines are typically used first until depleted.' })
                          : eligibleContractLines.length === 1
                            ? t('usage.contractLineGuidance.tooltipSingle', { defaultValue: 'This usage will be billed under the "{{name}}" contract line.', name: eligibleContractLines[0].contract_line_name })
                            : t('usage.contractLineGuidance.tooltipNone', { defaultValue: 'No eligible contract lines found for this service.' })}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
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
                    ? t('usage.contractLineGuidance.placeholderNoClient', { defaultValue: 'Using system-managed default contract' })
                    : eligibleContractLines.length === 0
                      ? t('usage.contractLineGuidance.placeholderNone', { defaultValue: 'No eligible contract lines' })
                      : eligibleContractLines.length === 1
                        ? t('usage.contractLineGuidance.placeholderSingle', { defaultValue: 'Using {{name}}', name: eligibleContractLines[0].contract_line_name })
                        : t('usage.contractLineGuidance.placeholderSelect', { defaultValue: 'Select a contract line' })}
                  options={eligibleContractLines.map(plan => ({
                    value: plan.client_contract_line_id,
                    label: `${plan.contract_line_name} (${plan.contract_line_type})`
                  }))}
                />

                {eligibleContractLines.length > 1 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center">
                      <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                      {t('usage.contractLineGuidance.wrongContractLineWarning', { defaultValue: 'Selecting the wrong contract line may result in incorrect billing' })}
                    </span>
                  </div>
                )}

                {!newUsage.client_id ? (
                  <small className="text-muted-foreground mt-1">
                    {t('usage.contractLineGuidance.noClientNotice', { defaultValue: 'Client information not available. Usage will route to the system-managed default contract.' })}
                  </small>
                ) : eligibleContractLines.length === 0 ? (
                  <small className="text-muted-foreground mt-1">
                    {t('usage.contractLineGuidance.noEligibleNotice', { defaultValue: 'No eligible contract lines found for this service.' })}
                  </small>
                ) : <></>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteUsage}
        title={t('usage.deleteDialog.title', { defaultValue: 'Delete Usage Record' })}
        message={t('usage.deleteDialog.message', { defaultValue: 'Are you sure you want to delete this usage record? This action cannot be undone.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
      />
    </ReflectionContainer>
  );
};

export default UsageTracking;
