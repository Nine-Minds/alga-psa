'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Package } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../BucketOverlayFields';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const result = await getServices();
      if (result && Array.isArray(result.services)) {
        // Filter to only show services with billing_method === 'fixed'
        const fixedServices = result.services.filter(service => service.billing_method === 'fixed');
        setServices(fixedServices);
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
      fixed_services: [...data.fixed_services, { service_id: '', service_name: '', quantity: 1 }]
    });
  };

  const handleRemoveService = (index: number) => {
    const newServices = data.fixed_services.filter((_, i) => i !== index);
    updateData({ fixed_services: newServices });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find(s => s.service_id === serviceId);
    const newServices = [...data.fixed_services];
    newServices[index] = {
      ...newServices[index],
      service_id: serviceId,
      service_name: service?.service_name || ''
    };
    updateData({ fixed_services: newServices });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const newServices = [...data.fixed_services];
    newServices[index] = { ...newServices[index], quantity };
    updateData({ fixed_services: newServices });
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getDefaultOverlay = (): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly'
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const newServices = [...data.fixed_services];
    if (enabled) {
      const existing = newServices[index].bucket_overlay;
      newServices[index] = {
        ...newServices[index],
        bucket_overlay: existing ? { ...existing } : getDefaultOverlay()
      };
    } else {
      newServices[index] = {
        ...newServices[index],
        bucket_overlay: undefined
      };
    }
    updateData({ fixed_services: newServices });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const newServices = [...data.fixed_services];
    newServices[index] = {
      ...newServices[index],
      bucket_overlay: { ...overlay }
    };
    updateData({ fixed_services: newServices });
  };

  return (
    <ReflectionContainer id="fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Fixed Fee Services</h3>
          <p className="text-sm text-gray-600">
            Set up services that are billed at a fixed monthly rate, regardless of usage. This is ideal for managed services agreements.
          </p>
        </div>

      {/* Info Box */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800">
          <strong>Template guidance:</strong> Select which services belong in this fixed-fee bundle.
          Billing amounts will be entered when a client is assigned to the template.
        </p>
      </div>

      {/* Services List */}
      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          Services
        </Label>

        {data.fixed_services.map((service, index) => (
          <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`service-${index}`} className="text-sm">
                  Service {index + 1}
                </Label>
                <CustomSelect
                  id={`service-select-${index}`}
                  value={service.service_id}
                  onValueChange={(value: string) => handleServiceChange(index, value)}
                  options={serviceOptions}
                  placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                  disabled={isLoadingServices}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`quantity-${index}`} className="text-sm">
                  Quantity
                </Label>
                <Input
                  id={`quantity-${index}`}
                  type="number"
                  value={service.quantity}
                  onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                  min="1"
                  className="w-24"
                />
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label="Enable bucket of hours"
                  checked={Boolean(service.bucket_overlay)}
                  onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                />
                {service.bucket_overlay && (
                  <BucketOverlayFields
                    mode="hours"
                    value={service.bucket_overlay ?? getDefaultOverlay()}
                    onChange={(next) => updateBucketOverlay(index, next)}
                    automationId={`fixed-bucket-${index}`}
                  />
                )}
              </div>
            </div>

            <Button
              id={`remove-fixed-service-${index}`}
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
          id="add-fixed-service-button"
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Service
        </Button>
      </div>

      {/* Skip hint */}
      {data.fixed_services.length === 0 && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            No fixed fee services added yet. Click "Add Service" above or click "Skip" to configure other billing types.
          </p>
        </div>
      )}

      </div>
    </ReflectionContainer>
  );
}
