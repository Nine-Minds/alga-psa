'use client';

import React, { useEffect, useState } from 'react';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { TemplateWizardData, TemplateBucketOverlayInput } from '../TemplateWizard';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../../BucketOverlayFields';
import { BarChart3, Plus, X } from 'lucide-react';

interface TemplateUsageBasedServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateUsageBasedServicesStep({
  data,
  updateData,
}: TemplateUsageBasedServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServices();
        if (result && Array.isArray(result.services)) {
          const usageServices = result.services.filter(
            (service) => service.billing_method === 'usage'
          );
          setServices(usageServices);
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
      usage_services: [
        ...(data.usage_services ?? []),
        { service_id: '', service_name: '', unit_of_measure: '', bucket_overlay: undefined },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = (data.usage_services ?? []).filter((_, i) => i !== index);
    updateData({ usage_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...(data.usage_services ?? [])];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
      unit_of_measure: service?.unit_of_measure ?? next[index].unit_of_measure ?? '',
    };
    updateData({ usage_services: next });
  };

  const handleUnitChange = (index: number, unit: string) => {
    const next = [...(data.usage_services ?? [])];
    next[index] = { ...next[index], unit_of_measure: unit };
    updateData({ usage_services: next });
  };

  const getDefaultOverlay = (): TemplateBucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...(data.usage_services ?? [])];
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
    updateData({ usage_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: TemplateBucketOverlayInput) => {
    const next = [...(data.usage_services ?? [])];
    next[index] = { ...next[index], bucket_overlay: { ...overlay } };
    updateData({ usage_services: next });
  };

  return (
    <ReflectionContainer id="template-usage-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Usage-Based Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed based on usage or consumption. Perfect for metered services like data transfer, API calls, or storage.
          </p>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md mb-6">
          <p className="text-sm text-amber-800">
            <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics. Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.
          </p>
        </div>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Services
          </Label>

          {(data.usage_services ?? []).map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-usage-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-usage-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`template-unit-${index}`} className="text-sm">
                    Unit of measure
                  </Label>
                  <Input
                    id={`template-unit-${index}`}
                    value={service.unit_of_measure ?? ''}
                    onChange={(event) => handleUnitChange(index, event.target.value)}
                    placeholder="e.g., GB, devices, tickets"
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                  <SwitchWithLabel
                    label="Recommend bucket of consumption"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="usage"
                      value={service.bucket_overlay ?? getDefaultOverlay()}
                      onChange={(overlay) => updateBucketOverlay(index, overlay)}
                      automationId={`template-usage-bucket-${index}`}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`template-usage-remove-service-${index}`}
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
            id="template-usage-add-service"
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
