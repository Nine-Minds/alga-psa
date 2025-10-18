'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Activity } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../BucketOverlayFields';

interface UsageBasedServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function UsageBasedServicesStep({ data, updateData }: UsageBasedServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    void loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const result = await getServices();
      if (result && Array.isArray(result.services)) {
        // Filter to only show services with billing_method === 'usage'
        const usageServices = result.services.filter(service => service.billing_method === 'usage');
        setServices(usageServices);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setIsLoadingServices(false);
    }
  };

  const serviceOptions = services.map(service => ({
    value: service.service_id,
    label: service.service_name
  }));

  const handleAddService = () => {
    updateData({
      usage_services: [...(data.usage_services || []), {
        service_id: '',
        service_name: '',
        unit_of_measure: 'unit'
      }]
    });
  };

  const handleRemoveService = (index: number) => {
    const newServices = (data.usage_services || []).filter((_, i) => i !== index);
    updateData({ usage_services: newServices });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find(s => s.service_id === serviceId);
    const newServices = [...(data.usage_services || [])];
    newServices[index] = {
      ...newServices[index],
      service_id: serviceId,
      service_name: service?.service_name || '',
      unit_of_measure: service?.unit_of_measure || 'unit'
    };
    updateData({ usage_services: newServices });
  };

  const handleUnitChange = (index: number, unit: string) => {
    const newServices = [...(data.usage_services || [])];
    newServices[index] = { ...newServices[index], unit_of_measure: unit };
    updateData({ usage_services: newServices });
  };

  const defaultOverlay = (): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly'
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const services = data.usage_services || [];
    const newServices = [...services];
    if (enabled) {
      const existing = newServices[index]?.bucket_overlay;
      newServices[index] = {
        ...newServices[index],
        bucket_overlay: existing ? { ...existing } : defaultOverlay()
      };
    } else {
      newServices[index] = {
        ...newServices[index],
        bucket_overlay: undefined
      };
    }
    updateData({ usage_services: newServices });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const services = data.usage_services || [];
    const newServices = [...services];
    newServices[index] = {
      ...newServices[index],
      bucket_overlay: { ...overlay }
    };
    updateData({ usage_services: newServices });
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Usage-Based Services</h3>
        <p className="text-sm text-gray-600">
          Select usage-based services for this template. Actual rates and tiers will be captured when a client contract is created.
        </p>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800">
          <strong>Template guidance:</strong> Define the metrics you track and any suggested bucket allocations. Pricing per unit is entered later per client.
        </p>
      </div>

      {/* Services List */}
      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Usage-Based Services
        </Label>

        {(data.usage_services || []).map((service, index) => (
          <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`usage-service-select-${index}`} className="text-sm">
                  Service {index + 1}
                </Label>
                <CustomSelect
                  id={`usage-service-select-${index}`}
                  value={service.service_id}
                  onValueChange={(value: string) => handleServiceChange(index, value)}
                  options={serviceOptions}
                  placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                  disabled={isLoadingServices}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`unit-measure-${index}`} className="text-sm">
                  Unit of Measure
                </Label>
                <Input
                  id={`unit-measure-${index}`}
                  type="text"
                  value={service.unit_of_measure || 'unit'}
                  onChange={(e) => handleUnitChange(index, e.target.value)}
                  placeholder="e.g., GB, API call, user"
                />
                <p className="text-xs text-gray-500">
                  This label is shown during client assignment (examples: GB, API call, user).
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label="Attach usage bucket guidance"
                  checked={Boolean(service.bucket_overlay)}
                  onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                />
                {service.bucket_overlay && (
                  <BucketOverlayFields
                    mode="usage"
                    unitLabel={service.unit_of_measure}
                    value={service.bucket_overlay ?? defaultOverlay()}
                    onChange={(next) => updateBucketOverlay(index, next)}
                    automationId={`usage-bucket-${index}`}
                  />
                )}
              </div>
            </div>

            <Button
              id={`remove-usage-service-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveService(index)}
              className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <Button
          id="add-usage-service-button"
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Usage-Based Service
        </Button>
      </div>

      {/* Skip hint */}
      {(!data.usage_services || data.usage_services.length === 0) && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            No usage-based services added yet. Click "Add Usage-Based Service" above or click "Skip" if you don't need usage-based billing.
          </p>
        </div>
      )}

      {/* Summary */}
      {data.usage_services && data.usage_services.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Usage-Based Services Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Services:</strong> {data.usage_services.length}</p>
            <div className="mt-2 space-y-1">
              {data.usage_services.map((service, idx) => (
                <p key={`usage-summary-${idx}`}>
                  {service.service_name || 'Unnamed service'} — {service.unit_of_measure || 'unit'}
                  {service.bucket_overlay && ' • Bucket guidance included'}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
