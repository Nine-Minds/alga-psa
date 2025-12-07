'use client';

import React, { useEffect, useState } from 'react';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { TemplateWizardData } from '../TemplateWizard';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BarChart3, Plus, X } from 'lucide-react';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

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
        { service_id: '', service_name: '', unit_of_measure: '' },
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

  // Build preview services list
  const previewServices = React.useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      serviceId: string;
    }> = [];

    // Add individual services
    for (const service of data.usage_services ?? []) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.usage_services]);

  const handlePreviewRemoveService = (itemId: string) => {
    if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = (data.usage_services ?? []).findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-usage-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Usage-Based Services</h3>
          <p className="text-sm text-gray-600">
            Select services that are billed based on usage or consumption. Rates will be determined by the service's pricing in the client's currency when the contract is created.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md mb-6">
          <p className="text-sm text-accent-900">
            <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics. Each unit consumed will be multiplied by the service's unit rate to calculate the invoice amount.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="usage"
          onRemoveService={handlePreviewRemoveService}
        />

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
                    Unit of Measure (Optional)
                  </Label>
                  <Input
                    id={`template-unit-${index}`}
                    type="text"
                    value={service.unit_of_measure ?? ''}
                    onChange={(event) => handleUnitChange(index, event.target.value)}
                    placeholder="e.g., GB, API call, user"
                  />
                  <p className="text-xs text-gray-500">Override the default unit of measure for this service.</p>
                </div>
              </div>

              <Button
                id={`template-usage-remove-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveService(index)}
                className="mt-6 text-red-600 hover:text-red-700 hover:bg-red-50"
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
