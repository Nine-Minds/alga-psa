// server/src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Input } from 'server/src/components/ui/Input';
import { Plus, MoreVertical, Trash2 } from 'lucide-react';
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
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');

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

  const getDefaultOverlay = useCallback((): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency as 'weekly' | 'monthly'
  }), [billingFrequency]);

  const toggleBucketOverlay = async (serviceId: string, enabled: boolean) => {
    try {
      const currentServices = await getContractLinePresetServices(presetId);
      const updatedServices = currentServices.map(s => {
        if (s.service_id === serviceId) {
          if (enabled) {
            const defaultOverlay = getDefaultOverlay();
            return {
              ...s,
              bucket_total_minutes: defaultOverlay.total_minutes,
              bucket_overage_rate: defaultOverlay.overage_rate,
              bucket_allow_rollover: defaultOverlay.allow_rollover ?? false
            };
          } else {
            return {
              ...s,
              bucket_total_minutes: undefined,
              bucket_overage_rate: undefined,
              bucket_allow_rollover: undefined
            };
          }
        }
        return s;
      });

      await updateContractLinePresetServices(presetId, updatedServices);
      fetchData();
    } catch (error) {
      console.error('Error toggling bucket overlay:', error);
      setError('Failed to toggle bucket configuration');
    }
  };

  const updateBucketOverlay = async (serviceId: string, overlay: BucketOverlayInput) => {
    try {
      const currentServices = await getContractLinePresetServices(presetId);
      const updatedServices = currentServices.map(s => {
        if (s.service_id === serviceId) {
          return {
            ...s,
            bucket_total_minutes: overlay.total_minutes,
            bucket_overage_rate: overlay.overage_rate,
            bucket_allow_rollover: overlay.allow_rollover ?? false
          };
        }
        return s;
      });

      await updateContractLinePresetServices(presetId, updatedServices);
      fetchData();
    } catch (error) {
      console.error('Error updating bucket overlay:', error);
      setError('Failed to update bucket configuration');
    }
  };

  const handleAddServices = async () => {
    if (!presetId || selectedServicesToAdd.length === 0) return;

    try {
      const currentServices = await getContractLinePresetServices(presetId);
      const newServices = selectedServicesToAdd.map(serviceId => {
        const service = availableServices.find(s => s.service_id === serviceId);
        return {
          preset_id: presetId,
          service_id: serviceId,
          custom_rate: service?.default_rate || 0,
          quantity: undefined,
          unit_of_measure: undefined,
          bucket_total_minutes: undefined,
          bucket_overage_rate: undefined,
          bucket_allow_rollover: undefined
        };
      });

      const allServices = [...currentServices, ...newServices];

      await updateContractLinePresetServices(presetId, allServices);
      fetchData();
      setSelectedServicesToAdd([]);

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error adding services to preset:', error);
      setError('Failed to add services');
    }
  };

  const handleRemoveService = async (serviceId: string) => {
    if (!presetId) return;

    try {
      const currentServices = await getContractLinePresetServices(presetId);
      const updatedServices = currentServices.filter(s => s.service_id !== serviceId);

      await updateContractLinePresetServices(presetId, updatedServices);
      fetchData();

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error removing service from preset:', error);
      setError('Failed to remove service');
    }
  };

  const handleRateChange = async (serviceId: string, newRate: number) => {
    if (!presetId) return;

    try {
      const currentServices = await getContractLinePresetServices(presetId);
      const updatedServices = currentServices.map(s => ({
        ...s,
        custom_rate: s.service_id === serviceId ? newRate : s.custom_rate
      }));

      await updateContractLinePresetServices(presetId, updatedServices);
      fetchData();

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error updating service rate:', error);
      setError('Failed to update rate');
    }
  };

  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      !presetServices.some(ps => ps.service_id === availService.service_id) &&
      availService.billing_method === 'hourly'
  );

  return (
    <div>
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
        </>
      )}
    </div>
  );
};

export default HourlyContractLinePresetServicesList;
