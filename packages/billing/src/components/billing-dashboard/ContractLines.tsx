'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { MoreVertical, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ContractLineDialog } from './ContractLineDialog';
import { UnitOfMeasureInput } from '@alga-psa/ui/components/UnitOfMeasureInput';
import { getContractLines, getContractLineById, updateContractLine, deleteContractLine } from '@alga-psa/billing/actions/contractLineAction';
import { getContractLineServices, addServiceToContractLine, updateContractLineService, removeServiceFromContractLine } from '@alga-psa/billing/actions/contractLineServiceActions';
// Import new action and type
import { getServiceTypesForSelection } from '@alga-psa/billing/actions';
import { DeletionValidationResult, IContractLine, IContractLineService, IService, IServiceType } from '@alga-psa/types';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import {
  useFormatBillingFrequency,
  useFormatContractLineType,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { add } from 'date-fns';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContractLinesProps {
  initialServices: IService[];
}

const ContractLines: React.FC<ContractLinesProps> = ({ initialServices }) => {
  const { t } = useTranslation('msp/contract-lines');
  const formatBillingFrequency = useFormatBillingFrequency();
  const formatContractLineType = useFormatContractLineType();
  const router = useRouter();
  const [contractLines, setContractLines] = useState<IContractLine[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [planServices, setPlanServices] = useState<IContractLineService[]>([]);
  const [selectedServiceToAdd, setSelectedServiceToAdd] = useState<string | null>(null);
  const [availableServices, setAvailableServices] = useState<IService[]>(initialServices);
  const [error, setError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<IContractLine | null>(null);
  const [contractLineToDelete, setContractLineToDelete] = useState<IContractLine | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  // Add state for all service types (standard + tenant-specific)
  const [allServiceTypes, setAllServiceTypes] = useState<
    { id: string; name: string; billing_method: IServiceType['billing_method']; is_standard: boolean }[]
  >([]);
  const tenant = useTenant();

  useEffect(() => {
    fetchContractLines();
    fetchAllServiceTypes(); // Fetch service types on mount
  }, [t]);

  // Effect to fetch all service types
  const fetchAllServiceTypes = async () => {
    try {
      const types = await getServiceTypesForSelection();
      setAllServiceTypes(types);
    } catch (fetchError) {
      console.error('Error fetching service types:', fetchError);
      // Correctly handle unknown error type
      if (fetchError instanceof Error) {
        setError(fetchError.message);
      } else {
        setError(t('list.errors.unknownErrorFetchingServiceTypes', {
          defaultValue: 'An unknown error occurred while fetching service types',
        }));
      }
    }
  };

  useEffect(() => {
    if (selectedPlan) {
      fetchPlanServices(selectedPlan);
    }
  }, [selectedPlan]);

  useEffect(() => {
    const updatedAvailableServices = initialServices.filter(s => !planServices.some(ps => ps.service_id === s.service_id));
    setAvailableServices(updatedAvailableServices);

    if (!selectedServiceToAdd || !updatedAvailableServices.some(s => s.service_id === selectedServiceToAdd)) {
      setSelectedServiceToAdd(updatedAvailableServices[0]?.service_id || null);
    }
  }, [planServices, initialServices, selectedServiceToAdd]);

  const fetchContractLines = async () => {
    try {
      const plans = await getContractLines();
      setContractLines(plans);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      setError(t('list.errors.failedToFetchContractLines', {
        defaultValue: 'Failed to fetch contract lines',
      }));
    }
  };

  const resetDeleteState = () => {
    setContractLineToDelete(null);
    setDeleteValidation(null);
  };

  const runDeleteValidation = useCallback(async (contractLineId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('contract_line', contractLineId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate contract line deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('list.errors.failedToValidateDeletion', {
          defaultValue: 'Failed to validate deletion. Please try again.',
        }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [t]);

  const handleDeleteContractLine = (contractLine: IContractLine) => {
    setContractLineToDelete(contractLine);
    void runDeleteValidation(contractLine.contract_line_id!);
  };

  const confirmDelete = async () => {
    if (!contractLineToDelete) {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      const result = await deleteContractLine(contractLineToDelete.contract_line_id!);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }
      await fetchContractLines();
      toast.success(t('list.toast.contractLineDeletedSuccessfully', {
        defaultValue: 'Contract line deleted successfully',
      }));
      resetDeleteState();
    } catch (error) {
      handleError(error, t('list.errors.failedToDeleteContractLine', {
        defaultValue: 'Failed to delete contract line',
      }));
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const fetchPlanServices = async (planId: string) => {
    try {
      const services = await getContractLineServices(planId);
      setPlanServices(services);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract line services:', error);
      setError(t('list.errors.failedToFetchContractLineServices', {
        defaultValue: 'Failed to fetch contract line services',
      }));
    }
  };

  const handleAddPlanService = async (serviceId: string) => {
    if (!selectedPlan) return;
    try {
      const addedService = initialServices.find(s => s.service_id === serviceId);
      if (addedService) {
        const newPlanService = {
          contract_line_id: selectedPlan,
          service_id: serviceId,
          quantity: 1,
          custom_rate: addedService.default_rate,
          tenant: tenant!
        };
        await addServiceToContractLine(
          selectedPlan,
          serviceId,
          newPlanService.quantity,
          newPlanService.custom_rate
        );
        // setPlanServices(prevServices => [...prevServices, newPlanService]); // Remove optimistic update
        fetchPlanServices(selectedPlan); // Re-fetch the list from the server
        setError(null);
      }
    } catch (error) {
      console.error('Error adding contract line service:', error);
      setError(t('list.errors.failedToAddContractLineService', {
        defaultValue: 'Failed to add contract line service',
      }));
    }
  };

  const handleUpdatePlanService = async (serviceId: string, quantity: number, customRate: number | undefined) => {
    if (!selectedPlan) return;
    try {
      await updateContractLineService(selectedPlan, serviceId, { quantity, customRate });
      fetchPlanServices(selectedPlan);
      setError(null);
    } catch (error) {
      console.error('Error updating contract line service:', error);
      setError(t('list.errors.failedToUpdateContractLineService', {
        defaultValue: 'Failed to update contract line service',
      }));
    }
  };

  const handleRemovePlanService = async (serviceId: string) => {
    if (!selectedPlan) return;
    try {
      await removeServiceFromContractLine(selectedPlan, serviceId);
      fetchPlanServices(selectedPlan);
      setError(null);
    } catch (error) {
      console.error('Error removing contract line service:', error);
      setError(t('list.errors.failedToRemoveContractLineService', {
        defaultValue: 'Failed to remove contract line service',
      }));
    }
  };

  const contractLineColumns: ColumnDefinition<IContractLine>[] = [
    {
      title: t('list.columns.contractLineName', { defaultValue: 'Contract Line Name' }),
      dataIndex: 'contract_line_name',
    },
    {
      title: t('list.columns.billingFrequency', { defaultValue: 'Billing Frequency' }),
      dataIndex: 'billing_frequency',
      render: (value) => formatBillingFrequency(value),
    },
    {
      title: t('list.columns.contractLineType', { defaultValue: 'Contract Line Type' }),
      dataIndex: 'contract_line_type',
      render: (value) => formatContractLineType(value),
    },
    {
      title: t('list.columns.isCustom', { defaultValue: 'Is Custom' }),
      dataIndex: 'is_custom',
      render: (value) => value
        ? t('common.labels.yes', { defaultValue: 'Yes' })
        : t('common.labels.no', { defaultValue: 'No' }),
    },
    {
      title: t('list.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'contract_line_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="contract-line-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('common.actions.openMenu', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-contract-line-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setEditingPlan({...record});
              }}
            >
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-line-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                handleDeleteContractLine(record);
              }}
            >
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const planServiceColumns: ColumnDefinition<IContractLineService>[] = [
    {
      title: t('list.planServices.columns.serviceName', { defaultValue: 'Service Name' }),
      dataIndex: 'service_id',
      render: (value, record) => {
        const service = initialServices.find(s => s.service_id === value);
        return (
          <div className="flex items-center">
            <span>{service?.service_name || ''}</span>
          </div>
        );
      },
    },
    {
      title: t('list.planServices.columns.quantity', { defaultValue: 'Quantity' }),
      dataIndex: 'quantity',
      render: (value, record) => (
          <Input
            type="number"
            value={value?.toString() || ''}
            onChange={(e) =>
              handleUpdatePlanService(record.service_id, Number(e.target.value), record.custom_rate ?? undefined)
            }
            className="w-24 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
      ),
    },
    {
      title: t('list.planServices.columns.unitOfMeasure', { defaultValue: 'Unit of Measure' }),
      dataIndex: 'service_id',
      render: (value) => {
        const service = initialServices.find(s => s.service_id === value);
        return (
          <UnitOfMeasureInput
            value={service?.unit_of_measure || ''}
            onChange={(value: string) => {
              if (service) {
                // Update the service's unit of measure in the database
                // This would typically update the service itself, not the plan-service relationship
                console.log('Updating unit of measure for service:', service.service_id, 'to', value);
                // In Phase 2, implement actual service update here
              }
            }}
          />
        );
      },
    },
    {
      title: t('list.planServices.columns.customRate', { defaultValue: 'Custom Rate' }),
      dataIndex: 'custom_rate',
      render: (value, record) => (
        <Input
          type="number"
          value={value?.toString() || ''}
          onChange={(e) => {
            const newValue = e.target.value === '' ? undefined : Number(e.target.value);
            handleUpdatePlanService(record.service_id, record.quantity || 0, newValue);
          }}
          className="w-24 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      ),
    },
    {
      title: t('list.planServices.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="plan-service-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('common.actions.openMenu', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="remove-plan-service-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleRemovePlanService(value);
              }}
            >
              {t('common.actions.remove', { defaultValue: 'Remove' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const handleContractLineClick = (plan: IContractLine) => {
    if (plan.contract_line_id) {
      setSelectedPlan(plan.contract_line_id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card size="2">
          <Box p="4">
            <Heading as="h3" size="4" mb="4">
              {t('list.heading', { defaultValue: 'Contract Lines' })}
            </Heading>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <ContractLineDialog
                onPlanAdded={(newPlanId) => {
                  fetchContractLines().then(async () => {
                    if (newPlanId) {
                      setSelectedPlan(newPlanId);

                      // Fetch the newly created plan and navigate to its configuration page
                      try {
                        const newPlan = await getContractLineById(newPlanId);
                        if (newPlan) {
                          // Navigate to the appropriate configuration page based on plan type
                          router.push(`/msp/billing?tab=contract-lines&contractLineId=${newPlanId}`);
                        }
                      } catch (error) {
                        console.error('Error fetching new plan for configuration:', error);
                      }
                    }
                  });
                }}
                editingPlan={null}
                onClose={() => setEditingPlan(null)}
                allServiceTypes={allServiceTypes} // Pass service types down
                triggerButton={
                  <Button id='add-contract-line-button'>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('list.actions.addContractLine', { defaultValue: 'Add Contract Line' })}
                  </Button>
                }
              />
            </div>
            <DataTable
              id="contract-lines-table"
              data={contractLines.filter(plan => plan.contract_line_id !== undefined)}
              columns={contractLineColumns}
              pagination={false}
              onRowClick={handleContractLineClick}
            />
          </Box>
        </Card>
        <Card size="2">
          <Box p="4">
            <Heading as="h3" size="4" mb="4">
              {t('list.planServices.heading', { defaultValue: 'Plan Services' })}
            </Heading>
            {selectedPlan ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h4>
                    {t('list.planServices.servicesFor', {
                      defaultValue: 'Services for {{name}}',
                      name: contractLines.find(p => p.contract_line_id === selectedPlan)?.contract_line_name,
                    })}
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <DataTable
                    id="plan-services-table"
                    data={planServices}
                    columns={planServiceColumns}
                    pagination={false}
                  />
                </div>
                <div className="flex space-x-2 mt-4">
                  <CustomSelect
                    options={availableServices.map((s): { value: string; label: string } => ({
                      value: s.service_id!,
                      label: s.service_name
                    }))}
                    onValueChange={setSelectedServiceToAdd}
                    value={selectedServiceToAdd || 'unassigned'}
                    placeholder={t('list.planServices.selectServicePlaceholder', {
                      defaultValue: 'Select service...',
                    })}
                  />
                  <Button
                    id='add-button'
                    onClick={() => {
                      if (selectedServiceToAdd && selectedServiceToAdd !== 'unassigned') {
                        handleAddPlanService(selectedServiceToAdd);
                      }
                    }}
                    disabled={!selectedServiceToAdd || selectedServiceToAdd === 'unassigned' || availableServices.length === 0}
                  >
                    {t('list.planServices.actions.addService', { defaultValue: 'Add Service' })}
                  </Button>
                </div>
              </>
            ) : (
              <p>
                {t('list.planServices.emptyStateSelectContractLine', {
                  defaultValue: 'Select a contract line to manage its services',
                })}
              </p>
            )}
          </Box>
        </Card>
      </div>
      <DeleteEntityDialog
        id="delete-contract-line-dialog"
        isOpen={Boolean(contractLineToDelete)}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        entityName={contractLineToDelete?.contract_line_name || t('list.deleteDialog.defaultEntityName', {
          defaultValue: 'this contract line',
        })}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </div>
  );
};

export default ContractLines;
