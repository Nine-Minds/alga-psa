// server/src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Input } from 'server/src/components/ui/Input';
import { Plus, MoreVertical, Trash2, Save } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { IContractLinePresetService, IService } from 'server/src/interfaces/billing.interfaces';
import {
  getContractLinePresetServices,
  updateContractLinePresetServices,
  getContractLinePresetById
} from 'server/src/lib/actions/contractLinePresetActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../contracts/BucketOverlayFields';
import { BucketOverlayInput } from '../contracts/ContractWizard';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { toast } from 'react-hot-toast';

const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'hourly' | 'usage'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' }
];

interface HourlyContractLinePresetServicesListProps {
  presetId: string;
  onServiceAdded?: () => void;
}

interface PresetServiceWithBucket extends IContractLinePresetService {
  service_name?: string;
  service_type_name?: string;
  billing_method?: 'fixed' | 'hourly' | 'usage' | null;
  default_rate?: number;
  bucket_overlay?: BucketOverlayInput | null;
}

const HourlyContractLinePresetServicesList: React.FC<HourlyContractLinePresetServicesListProps> = ({ presetId, onServiceAdded }) => {
  const [presetServices, setPresetServices] = useState<PresetServiceWithBucket[]>([]);
  const [originalServices, setOriginalServices] = useState<PresetServiceWithBucket[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [showNavigateAwayConfirm, setShowNavigateAwayConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!presetId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch preset to get billing frequency
      const preset = await getContractLinePresetById(presetId);
      if (preset) {
        setBillingFrequency(preset.billing_frequency || 'monthly');
      }

      const presetServicesData = await getContractLinePresetServices(presetId);
      const servicesResponse = await getServices();
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);

      const enhancedServices: PresetServiceWithBucket[] = presetServicesData.map((presetService) => {
        const serviceDetails = allAvailableServices.find(s => s.service_id === presetService.service_id);

        // Convert bucket fields to bucket_overlay format
        const bucketOverlay: BucketOverlayInput | null =
          presetService.bucket_total_minutes != null && presetService.bucket_overage_rate != null
            ? {
                total_minutes: presetService.bucket_total_minutes,
                overage_rate: presetService.bucket_overage_rate,
                allow_rollover: presetService.bucket_allow_rollover ?? false,
                billing_period: (preset?.billing_frequency || 'monthly') as 'weekly' | 'monthly'
              }
            : null;

        return {
          ...presetService,
          service_name: serviceDetails?.service_name || 'Unknown Service',
          service_type_name: serviceDetails?.service_type_name || 'N/A',
          billing_method: serviceDetails?.billing_method,
          default_rate: serviceDetails?.default_rate,
          bucket_overlay: bucketOverlay
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
  }, [presetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Detect unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (originalServices.length !== presetServices.length) return true;

    return presetServices.some((service, index) => {
      const original = originalServices.find(o => o.service_id === service.service_id);
      if (!original) return true;

      // Compare custom rate
      if (service.custom_rate !== original.custom_rate) return true;

      // Compare bucket configuration
      const serviceHasBucket = Boolean(service.bucket_overlay);
      const originalHasBucket = Boolean(original.bucket_overlay);

      if (serviceHasBucket !== originalHasBucket) return true;

      if (serviceHasBucket && originalHasBucket) {
        if (service.bucket_overlay!.total_minutes !== original.bucket_overlay!.total_minutes) return true;
        if (service.bucket_overlay!.overage_rate !== original.bucket_overlay!.overage_rate) return true;
        if (service.bucket_overlay!.allow_rollover !== original.bucket_overlay!.allow_rollover) return true;
      }

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

  const getDefaultOverlay = useCallback((): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency as 'weekly' | 'monthly'
  }), [billingFrequency]);

  const toggleBucketOverlay = (serviceId: string, enabled: boolean) => {
    setPresetServices(currentServices => currentServices.map(s => {
      if (s.service_id === serviceId) {
        if (enabled) {
          const defaultOverlay = getDefaultOverlay();
          return {
            ...s,
            bucket_overlay: defaultOverlay
          };
        } else {
          return {
            ...s,
            bucket_overlay: null
          };
        }
      }
      return s;
    }));
  };

  const updateBucketOverlay = (serviceId: string, overlay: BucketOverlayInput) => {
    setPresetServices(currentServices => currentServices.map(s => {
      if (s.service_id === serviceId) {
        return {
          ...s,
          bucket_overlay: overlay
        };
      }
      return s;
    }));
  };

  const handleAddServices = () => {
    if (selectedServicesToAdd.length === 0) return;

    const newServices: PresetServiceWithBucket[] = selectedServicesToAdd.map(serviceId => {
      const service = availableServices.find(s => s.service_id === serviceId);
      return {
        preset_id: presetId,
        service_id: serviceId,
        custom_rate: service?.default_rate || 0,
        quantity: undefined,
        unit_of_measure: undefined,
        bucket_total_minutes: undefined,
        bucket_overage_rate: undefined,
        bucket_allow_rollover: undefined,
        tenant: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        service_name: service?.service_name || 'Unknown Service',
        service_type_name: service?.service_type_name || 'N/A',
        billing_method: service?.billing_method,
        default_rate: service?.default_rate,
        bucket_overlay: null
      };
    });

    setPresetServices([...presetServices, ...newServices]);
    setSelectedServicesToAdd([]);
  };

  const handleRemoveService = (serviceId: string) => {
    setPresetServices(presetServices.filter(s => s.service_id !== serviceId));
  };

  const handleRateChange = (serviceId: string, newRate: number) => {
    setPresetServices(currentServices => currentServices.map(s => ({
      ...s,
      custom_rate: s.service_id === serviceId ? newRate : s.custom_rate
    })));
  };

  const handleSave = async () => {
    if (!presetId || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      // Convert bucket_overlay back to flat fields for API
      const servicesToSave = presetServices.map(s => ({
        preset_id: s.preset_id,
        service_id: s.service_id,
        custom_rate: s.custom_rate,
        quantity: s.quantity,
        unit_of_measure: s.unit_of_measure,
        bucket_total_minutes: s.bucket_overlay?.total_minutes,
        bucket_overage_rate: s.bucket_overlay?.overage_rate,
        bucket_allow_rollover: s.bucket_overlay?.allow_rollover
      }));

      await updateContractLinePresetServices(presetId, servicesToSave);
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

  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      !presetServices.some(ps => ps.service_id === availService.service_id) &&
      availService.billing_method === 'hourly'
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
            {presetServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No services currently associated with this contract line preset.</p>
            ) : (
              <div className="space-y-3">
                {presetServices.map((service) => (
                  <div key={service.service_id} className="border rounded-lg p-4 bg-white">
                    {/* Service Header */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1">
                        <h4 className="font-medium">{service.service_name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Service Type: {service.service_type_name} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            id={`preset-service-actions-${service.service_id}`}
                            variant="ghost"
                            className="h-8 w-8 p-0"
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            id={`remove-preset-service-${service.service_id}`}
                            className="text-red-600 focus:text-red-600"
                            onClick={() => handleRemoveService(service.service_id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Hourly Rate */}
                    <div className="flex items-center gap-2 mb-3">
                      <label className="text-sm font-medium w-24">Hourly Rate:</label>
                      <span className="text-gray-500">$</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={service.custom_rate !== undefined ? (service.custom_rate / 100).toFixed(2) : ''}
                        onChange={(e) => {
                          const dollars = parseFloat(e.target.value) || 0;
                          const cents = Math.round(dollars * 100);
                          handleRateChange(service.service_id, cents);
                        }}
                        className="w-32"
                      />
                    </div>

                    {/* Bucket Overlay Section */}
                    <div className="space-y-3 pt-3 border-t border-dashed border-secondary-100">
                      <SwitchWithLabel
                        label="Recommend bucket of hours"
                        checked={Boolean(service.bucket_overlay)}
                        onCheckedChange={(checked) => toggleBucketOverlay(service.service_id, Boolean(checked))}
                      />
                      {service.bucket_overlay && (
                        <BucketOverlayFields
                          mode="hours"
                          value={service.bucket_overlay}
                          onChange={(overlay) => updateBucketOverlay(service.service_id, overlay)}
                          automationId={`preset-hourly-bucket-${service.service_id}`}
                          billingFrequency={billingFrequency}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 border-t pt-4">
            <h4 className="text-md font-medium mb-2">Add Services to Contract Line Preset</h4>
            {servicesAvailableToAdd.length === 0 ? (
              <p className="text-sm text-muted-foreground">All available hourly services are already associated with this preset.</p>
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
                              Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Default Rate: ${(Number(service.default_rate) / 100).toFixed(2)}
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

export default HourlyContractLinePresetServicesList;
