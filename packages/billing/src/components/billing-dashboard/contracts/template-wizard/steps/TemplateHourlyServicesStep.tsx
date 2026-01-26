'use client';

import React from 'react';
import { TemplateWizardData } from '../TemplateWizard';
import { Label } from '@alga-psa/ui/components/Label';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../../ServiceCatalogPicker';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Plus, X, Activity } from 'lucide-react';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

interface TemplateHourlyServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateHourlyServicesStep({
  data,
  updateData,
}: TemplateHourlyServicesStepProps) {
  const handleAddService = () => {
    updateData({
      hourly_services: [
        ...data.hourly_services,
        { service_id: '', service_name: '' },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.hourly_services.filter((_, i) => i !== index);
    updateData({ hourly_services: next });
  };

  const handleServiceChange = (index: number, item: ServiceCatalogPickerItem) => {
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
    };
    updateData({ hourly_services: next });
  };

  // Build preview services list
  const previewServices = React.useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      serviceId: string;
    }> = [];

    // Add individual services
    for (const service of data.hourly_services) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.hourly_services]);

  const handlePreviewRemoveService = (itemId: string) => {
    if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.hourly_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-hourly-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Hourly Services</h3>
          <p className="text-sm text-gray-600">
            Select services that are billed based on time tracked. Rates will be determined by the service's pricing in the client's currency when the contract is created.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md mb-6">
          <p className="text-sm text-accent-900">
            <strong>What are Hourly Services?</strong> These services are billed based on actual time tracked. Each time entry will be multiplied by the service's hourly rate to calculate the invoice amount.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="hourly"
          onRemoveService={handlePreviewRemoveService}
        />

        {/* Time rounding settings - shown once if any hourly services are added */}
        {data.hourly_services.length > 0 && (
          <div className="p-4 border border-gray-200 rounded-md bg-gray-50">
            <h4 className="text-sm font-medium mb-3">Time Rounding Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-min-time" className="text-sm">
                  Minimum Billable Time (minutes)
                </Label>
                <Input
                  id="template-min-time"
                  type="number"
                  min="0"
                  value={data.minimum_billable_time ?? ''}
                  onChange={(event) =>
                    updateData({
                      minimum_billable_time: Math.max(
                        0,
                        Number(event.target.value) || 0
                      ),
                    })
                  }
                  placeholder="15"
                />
                <p className="text-xs text-gray-500">e.g., 15 minutes - any time entry less than this will be rounded up</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-round-up" className="text-sm">
                  Round Up To Nearest (minutes)
                </Label>
                <Input
                  id="template-round-up"
                  type="number"
                  min="0"
                  value={data.round_up_to_nearest ?? ''}
                  onChange={(event) =>
                    updateData({
                      round_up_to_nearest: Math.max(
                        0,
                        Number(event.target.value) || 0
                      ),
                    })
                  }
                  placeholder="15"
                />
                <p className="text-xs text-gray-500">e.g., 15 minutes - time entries will be rounded up to the nearest interval</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Services
          </Label>

          {data.hourly_services.map((service, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor={`template-hourly-service-${index}`} className="text-sm">
                  Service {index + 1}
                </Label>
                <ServiceCatalogPicker
                  id={`template-hourly-service-${index}`}
                  value={service.service_id}
                  selectedLabel={service.service_name}
                  onSelect={(item) => handleServiceChange(index, item)}
                  billingMethods={['hourly']}
                  itemKinds={['service']}
                  placeholder="Select a service"
                />
              </div>

              <Button
                id={`template-hourly-remove-service-${index}`}
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
            id="template-hourly-add-service"
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
