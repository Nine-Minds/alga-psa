'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Clock } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../BucketOverlayFields';

interface HourlyServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function HourlyServicesStep({ data, updateData }: HourlyServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const result = await getServices();
      if (result && Array.isArray(result.services)) {
        // Filter to only show services with billing_method === 'hourly'
        const hourlyServices = result.services.filter(service => service.billing_method === 'hourly');
        setServices(hourlyServices);
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
      hourly_services: [...data.hourly_services, { service_id: '', service_name: '', hourly_rate: undefined }]
    });
  };

  const handleRemoveService = (index: number) => {
    const newServices = data.hourly_services.filter((_, i) => i !== index);
    updateData({ hourly_services: newServices });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find(s => s.service_id === serviceId);
    const newServices = [...data.hourly_services];
    newServices[index] = {
      ...newServices[index],
      service_id: serviceId,
      service_name: service?.service_name || ''
    };
    updateData({ hourly_services: newServices });
  };

  const defaultOverlay = (): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly'
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const newServices = [...data.hourly_services];
    if (enabled) {
      const existing = newServices[index].bucket_overlay;
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
    updateData({ hourly_services: newServices });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const newServices = [...data.hourly_services];
    newServices[index] = {
      ...newServices[index],
      bucket_overlay: { ...overlay }
    };
    updateData({ hourly_services: newServices });
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Hourly Services</h3>
        <p className="text-sm text-gray-600">
          Select time-based services that belong on this template. Pricing is captured later when assigning the template to a client.
        </p>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800">
          <strong>Template guidance:</strong> Configure minimum billable time, rounding preferences, and optional hour buckets. Hourly rates will be entered per client.
        </p>
      </div>

      {/* Minimum Billable Time */}
      {data.hourly_services.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="minimum_billable_time" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Minimum Billable Time (minutes)
          </Label>
          <Input
            id="minimum_billable_time"
            type="number"
            value={data.minimum_billable_time || ''}
            onChange={(e) => updateData({ minimum_billable_time: parseInt(e.target.value) || undefined })}
            placeholder="15"
            min="0"
            step="15"
            className="w-32"
          />
          <p className="text-xs text-gray-500">
            e.g., 15 minutes - any time entry less than this will be rounded up
          </p>
        </div>
      )}

      {/* Round Up Settings */}
      {data.hourly_services.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="round_up_to_nearest" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Round Up To Nearest (minutes)
          </Label>
          <Input
            id="round_up_to_nearest"
            type="number"
            value={data.round_up_to_nearest || ''}
            onChange={(e) => updateData({ round_up_to_nearest: parseInt(e.target.value) || undefined })}
            placeholder="15"
            min="0"
            step="15"
            className="w-32"
          />
          <p className="text-xs text-gray-500">
            e.g., 15 minutes - time entries will be rounded up to the nearest interval
          </p>
        </div>
      )}

      {/* Services List */}
      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Hourly Services
        </Label>

        {data.hourly_services.map((service, index) => (
          <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                  Service {index + 1}
                </Label>
                <CustomSelect
                  value={service.service_id}
                  onValueChange={(value: string) => handleServiceChange(index, value)}
                  options={serviceOptions}
                  placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                  disabled={isLoadingServices}
                  className="w-full"
                />
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label="Include bucket of hours"
                  checked={Boolean(service.bucket_overlay)}
                  onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                />
                {service.bucket_overlay && (
                  <BucketOverlayFields
                    mode="hours"
                    value={service.bucket_overlay ?? defaultOverlay()}
                    onChange={(next) => updateBucketOverlay(index, next)}
                    automationId={`hourly-bucket-${index}`}
                  />
                )}
              </div>
            </div>

            <Button
              id={`remove-hourly-service-${index}`}
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
          id="add-hourly-service-button"
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Hourly Service
        </Button>
      </div>

      {/* Skip hint */}
      {data.hourly_services.length === 0 && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            No hourly services added yet. Click "Add Hourly Service" above or click "Skip" if you don't need T&M billing.
          </p>
        </div>
      )}

      {/* Summary */}
      {data.hourly_services.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Hourly Services Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Services:</strong> {data.hourly_services.length}</p>
            {data.minimum_billable_time && (
              <p><strong>Minimum Time:</strong> {data.minimum_billable_time} minutes</p>
            )}
            {data.round_up_to_nearest && (
              <p><strong>Round Up:</strong> Every {data.round_up_to_nearest} minutes</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
