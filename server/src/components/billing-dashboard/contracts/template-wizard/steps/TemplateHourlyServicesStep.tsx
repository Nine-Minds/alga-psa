'use client';

import React, { useEffect, useState } from 'react';
import { IService } from 'server/src/interfaces';
import { getServices } from '@product/actions/serviceActions';
import { TemplateWizardData, TemplateBucketOverlayInput } from '../TemplateWizard';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../../BucketOverlayFields';
import { Plus, X, Activity } from 'lucide-react';

interface TemplateHourlyServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateHourlyServicesStep({
  data,
  updateData,
}: TemplateHourlyServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServices();
        if (result && Array.isArray(result.services)) {
          const hourlyServices = result.services.filter(
            (service) => service.billing_method === 'hourly'
          );
          setServices(hourlyServices);
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
      hourly_services: [
        ...data.hourly_services,
        { service_id: '', service_name: '', bucket_overlay: undefined },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.hourly_services.filter((_, i) => i !== index);
    updateData({ hourly_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
    };
    updateData({ hourly_services: next });
  };

  const getDefaultOverlay = (): TemplateBucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.hourly_services];
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
    updateData({ hourly_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: TemplateBucketOverlayInput) => {
    const next = [...data.hourly_services];
    next[index] = { ...next[index], bucket_overlay: { ...overlay } };
    updateData({ hourly_services: next });
  };

  return (
    <ReflectionContainer id="template-hourly-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Hourly Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed based on time tracked. Perfect for T&M (Time & Materials) work.
          </p>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md mb-6">
          <p className="text-sm text-amber-800">
            <strong>What are Hourly Services?</strong> These services are billed based on actual time tracked. Each time entry will be multiplied by the hourly rate to calculate the invoice amount.
          </p>
        </div>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Services
          </Label>

          {data.hourly_services.map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-hourly-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-hourly-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor={`template-min-time-${index}`} className="text-sm">
                      Minimum billable minutes
                    </Label>
                    <Input
                      id={`template-min-time-${index}`}
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
                    />
                  </div>
                  <div>
                    <Label htmlFor={`template-round-up-${index}`} className="text-sm">
                      Round up to nearest (minutes)
                    </Label>
                    <Input
                      id={`template-round-up-${index}`}
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
                    />
                  </div>
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
                      automationId={`template-hourly-bucket-${index}`}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`template-hourly-remove-service-${index}`}
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
