// server/src/components/billing-dashboard/FixedContractLinePresetServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { Plus, MoreVertical, HelpCircle, Save } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContractLinePresetService, IService } from 'server/src/interfaces/billing.interfaces';
import {
  getContractLinePresetServices,
  updateContractLinePresetServices
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'hourly' | 'usage'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' }
];

interface FixedContractLinePresetServicesListProps {
  planId: string; // This is actually the presetId
  onServiceAdded?: () => void;
}

// Simplified interface for display
interface SimplePresetService {
  preset_id: string;
  service_id: string;
  service_name?: string;
  service_type_name?: string;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  default_rate?: number;
  quantity?: number;
}

const FixedContractLinePresetServicesList: React.FC<FixedContractLinePresetServicesListProps> = ({ planId, onServiceAdded }) => {
  const [presetServices, setPresetServices] = useState<SimplePresetService[]>([]);
  const [originalServices, setOriginalServices] = useState<SimplePresetService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNavigateAwayConfirm, setShowNavigateAwayConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!planId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch preset services
      const presetServicesData = await getContractLinePresetServices(planId);

      // Fetch all available services
      const servicesResponse = await getServices(1, 999, { item_kind: 'any' });
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);

      // Enhance preset services with service details
      const enhancedServices: SimplePresetService[] = presetServicesData.map((presetService) => {
        const serviceDetails = allAvailableServices.find(s => s.service_id === presetService.service_id);
        return {
          preset_id: presetService.preset_id,
          service_id: presetService.service_id,
          service_name: serviceDetails?.service_name || 'Unknown Service',
          service_type_name: serviceDetails?.service_type_name || 'N/A',
          billing_method: serviceDetails?.billing_method,
          default_rate: serviceDetails?.default_rate,
          quantity: presetService.quantity || 1
        };
      });

      setPresetServices(enhancedServices);
      setOriginalServices(enhancedServices);
      setAvailableServices(allAvailableServices);
      setSelectedServicesToAdd([]);
    } catch (error) {
      console.error('Error fetching preset services data:', error);
      setError('Failed to load services data');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Detect unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (originalServices.length !== presetServices.length) return true;

    return presetServices.some((service) => {
      const original = originalServices.find(o => o.service_id === service.service_id);
      if (!original) return true;

      // Compare quantity
      if (service.quantity !== original.quantity) return true;

      return false;
    });
  }, [presetServices, originalServices]);

  // Navigation warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!hasUnsavedChanges) return;

      const target = e.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement;

      if (link && link.href) {
        const currentPath = window.location.pathname + window.location.search;
        const linkPath = new URL(link.href, window.location.origin).pathname + new URL(link.href, window.location.origin).search;

        if (linkPath !== currentPath && !link.target && !link.download) {
          e.preventDefault();
          e.stopPropagation();
          setPendingNavigation(link.href);
          setShowNavigateAwayConfirm(true);
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [hasUnsavedChanges]);

  const handleNavigateAwayConfirm = () => {
    if (pendingNavigation) {
      window.location.href = pendingNavigation;
    }
  };

  const handleNavigateAwayDismiss = () => {
    setShowNavigateAwayConfirm(false);
    setPendingNavigation(null);
  };

  const handleAddServices = () => {
    if (selectedServicesToAdd.length === 0) return;

    const newServices: SimplePresetService[] = selectedServicesToAdd.map(serviceId => {
      const service = availableServices.find(s => s.service_id === serviceId);
      return {
        preset_id: planId,
        service_id: serviceId,
        service_name: service?.service_name || 'Unknown Service',
        service_type_name: service?.service_type_name || 'N/A',
        billing_method: service?.billing_method,
        default_rate: service?.default_rate,
        quantity: 1
      };
    });

    setPresetServices([...presetServices, ...newServices]);
    setSelectedServicesToAdd([]);
  };

  const handleRemoveService = (serviceId: string) => {
    setPresetServices(presetServices.filter(s => s.service_id !== serviceId));
  };

  const handleQuantityChange = (serviceId: string, newQuantity: number) => {
    setPresetServices(currentServices => currentServices.map(s => ({
      ...s,
      quantity: s.service_id === serviceId ? Math.max(1, newQuantity) : s.quantity
    })));
  };

  const handleSave = async () => {
    if (!planId || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const servicesToSave = presetServices.map(s => ({
        preset_id: s.preset_id,
        service_id: s.service_id,
        quantity: s.quantity || 1
      }));

      await updateContractLinePresetServices(planId, servicesToSave);
      await fetchData();

      toast.success('Contract line preset services saved successfully');

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error saving preset services:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save services';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPresetServices([...originalServices]);
    setSelectedServicesToAdd([]);
    setError(null);
  };

  const presetServiceColumns: ColumnDefinition<SimplePresetService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_name',
    },
    {
      title: 'Category',
      dataIndex: 'service_type_name',
    },
    {
      title: 'Billing Method',
      dataIndex: 'billing_method',
      render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value || 'N/A',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      render: (value, record) => (
        <Input
          type="number"
          min="1"
          value={value ?? 1}
          onChange={(e) => {
            const newValue = parseInt(e.target.value) || 1;
            handleQuantityChange(record.service_id, newValue);
          }}
          className="w-20"
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      title: (
        <Tooltip content={
          <p>Service's standard rate, used for internal value allocation and reporting within the fixed plan total.</p>
        }>
          <span className="flex items-center cursor-help">
            Default Rate
            <HelpCircle className="h-4 w-4 ml-1 text-muted-foreground" />
          </span>
        </Tooltip>
      ),
      dataIndex: 'default_rate',
      render: (value) => value !== undefined ? `$${(Number(value) / 100).toFixed(2)}` : 'N/A',
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`preset-service-actions-${value}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`remove-preset-service-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveService(value);
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Filter out services already in the preset from the add list and only include services with 'fixed' billing method
  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      !presetServices.some(ps => ps.service_id === availService.service_id) &&
      availService.billing_method === 'fixed'
  );

  return (
    <div>
      {hasUnsavedChanges && (
        <Alert className="bg-amber-50 border-amber-200 mb-4">
          <AlertDescription className="text-amber-800 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>You have unsaved changes. Click "Save Changes" to apply them.</span>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="text-center py-4">Loading services...</div>
      ) : (
        <>
          <div className="mb-4">
            <DataTable
              data={presetServices}
              columns={presetServiceColumns}
              pagination={false}
            />
            {presetServices.length === 0 && <p className="text-sm text-muted-foreground mt-2">No services currently associated with this contract line.</p>}
          </div>

          <div className="mt-6 border-t pt-4">
            <h4 className="text-md font-medium mb-2">Add Services to Contract Line</h4>
            {servicesAvailableToAdd.length === 0 ? (
              <p className="text-sm text-muted-foreground">All available services are already associated with this contract line.</p>
            ) : (
              <>
                <div className="mb-3">
                  <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto border rounded p-2">
                    {servicesAvailableToAdd.map(service => {
                      const serviceTypeName = service.service_type_name || 'N/A';
                      return (
                        <div
                          key={service.service_id}
                          className="flex items-center space-x-2 p-1 hover:bg-muted/50 rounded"
                        >
                          <div className="[&>div]:mb-0">
                            <Checkbox
                              id={`add-service-${service.service_id}`}
                              checked={selectedServicesToAdd.includes(service.service_id!)}
                              onChange={(e) => {
                                if ((e.target as HTMLInputElement).checked) {
                                  setSelectedServicesToAdd([...selectedServicesToAdd, service.service_id!]);
                                } else {
                                  setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.service_id));
                                }
                              }}
                              className="cursor-pointer"
                            />
                          </div>
                          <div className="flex-grow flex flex-col text-sm">
                            <span>{service.service_name}</span>
                            <span className="text-xs text-muted-foreground">
                              Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Rate: ${(Number(service.default_rate) / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button
                  id="add-preset-services-button"
                  onClick={handleAddServices}
                  disabled={selectedServicesToAdd.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Selected Services {selectedServicesToAdd.length > 0 ? `(${selectedServicesToAdd.length})` : ''}
                </Button>
              </>
            )}
          </div>

          {/* Save/Reset Button Group */}
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
            <Button
              id="reset-preset-services"
              variant="outline"
              onClick={handleReset}
              disabled={isSaving || !hasUnsavedChanges}
            >
              Reset
            </Button>
            <Button
              id="save-preset-services"
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
            >
              <span className={hasUnsavedChanges ? 'font-bold' : ''}>
                {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes *' : 'Save Changes'}
              </span>
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </>
      )}

      {/* Navigation Warning Dialog */}
      <ConfirmationDialog
        isOpen={showNavigateAwayConfirm}
        onClose={handleNavigateAwayDismiss}
        onConfirm={handleNavigateAwayConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to leave this page? All changes will be lost."
        confirmLabel="Leave Page"
        cancelLabel="Stay on Page"
      />
    </div>
  );
};

export default FixedContractLinePresetServicesList;
