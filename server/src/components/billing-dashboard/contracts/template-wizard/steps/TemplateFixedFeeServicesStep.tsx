'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Package } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../../BucketOverlayFields';
import { TemplateBucketOverlayInput, TemplateWizardData } from '../TemplateWizard';

interface TemplateFixedFeeServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateFixedFeeServicesStep({
  data,
  updateData,
}: TemplateFixedFeeServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServices();
        if (result && Array.isArray(result.services)) {
          const fixedServices = result.services.filter(
            (service) => service.billing_method === 'fixed'
          );
          setServices(fixedServices);
        }
      } catch (error) {
        console.error('Error loading services:', error);
      } finally {
        setIsLoadingServices(false);
      }
    };

    void load();
  }, []);

  const serviceOptions = services.map((service) => ({
    value: service.service_id,
    label: service.service_name,
  }));

  const handleAddService = () => {
    updateData({
      fixed_services: [
        ...data.fixed_services,
        { service_id: '', service_name: '', quantity: 1, bucket_overlay: undefined },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.fixed_services.filter((_, i) => i !== index);
    updateData({ fixed_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...data.fixed_services];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
    };
    updateData({ fixed_services: next });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], quantity };
    updateData({ fixed_services: next });
  };

  const getDefaultOverlay = (): TemplateBucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.fixed_services];
    if (enabled) {
      next[index] = {
        ...next[index],
        bucket_overlay: next[index].bucket_overlay
          ? { ...next[index].bucket_overlay }
          : getDefaultOverlay(),
      };
    } else {
      next[index] = { ...next[index], bucket_overlay: undefined };
    }
    updateData({ fixed_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: TemplateBucketOverlayInput) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], bucket_overlay: { ...overlay } };
    updateData({ fixed_services: next });
  };

  return (
    <ReflectionContainer id="template-fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Fixed Fee Services</h3>
          <p className="text-sm text-gray-600">
            Select which fixed-fee services belong to this template bundle. Billing amounts are
            set when the template is applied to a client.
          </p>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>Tip:</strong> Use buckets to provide guardrails (e.g., hours included) and
            capture overage pricing guidance for teams.
          </p>
        </div>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Services
          </Label>

          {data.fixed_services.map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-fixed-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-fixed-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`template-fixed-quantity-${index}`} className="text-sm">
                    Quantity Guidance
                  </Label>
                  <Input
                    id={`template-fixed-quantity-${index}`}
                    type="number"
                    min="1"
                    value={service.quantity ?? 1}
                    onChange={(event) =>
                      handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                    }
                    className="w-28"
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                  <SwitchWithLabel
                    label="Recommend bucket of hours"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="hours"
                      value={service.bucket_overlay ?? getDefaultOverlay()}
                      onChange={(overlay) => updateBucketOverlay(index, overlay)}
                      automationId={`template-fixed-bucket-${index}`}
                    />
                  )}
                </div>
              </div>

              <Button
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
            type="button"
            variant="secondary"
            onClick={handleAddService}
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Service
          </Button>
        </div>
      </div>
    </ReflectionContainer>
  );
}
