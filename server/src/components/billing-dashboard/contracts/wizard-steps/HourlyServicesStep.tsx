'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Clock, DollarSign } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../BucketOverlayFields';
import { BillingFrequencyOverrideSelect } from '../BillingFrequencyOverrideSelect';

interface HourlyServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function HourlyServicesStep({ data, updateData }: HourlyServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    const loadServices = async () => {
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

    void loadServices();
  }, []);

  useEffect(() => {
    const inputs: Record<number, string> = {};
    data.hourly_services.forEach((service, index) => {
      if (service.hourly_rate !== undefined) {
        inputs[index] = (service.hourly_rate / 100).toFixed(2);
      }
    });
    setRateInputs(inputs);
  }, [data.hourly_services]);

  const serviceOptions = services.map((service) => ({
    value: service.service_id,
    label: service.service_name,
  }));

  const handleAddService = () => {
    updateData({
      hourly_services: [
        ...data.hourly_services,
        { service_id: '', service_name: '', hourly_rate: undefined, bucket_overlay: undefined },
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
      service_name: service?.service_name || '',
      hourly_rate: service?.default_rate ?? next[index].hourly_rate,
    };
    updateData({ hourly_services: next });
  };

  const handleRateChange = (index: number, cents: number) => {
    const next = [...data.hourly_services];
    next[index] = { ...next[index], hourly_rate: cents };
    updateData({ hourly_services: next });
  };

  const defaultOverlay = (billingFrequency: string): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency,
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.hourly_services];
    if (enabled) {
      const existing = next[index].bucket_overlay;
      const effectiveBillingFrequency = data.hourly_billing_frequency ?? data.billing_frequency;
      next[index] = {
        ...next[index],
        bucket_overlay: existing ? { ...existing } : defaultOverlay(effectiveBillingFrequency),
      };
    } else {
      next[index] = {
        ...next[index],
        bucket_overlay: undefined,
      };
    }
    updateData({ hourly_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      bucket_overlay: { ...overlay },
    };
    updateData({ hourly_services: next });
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
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
        <div className="space-y-2">
          <Label htmlFor="minimum-billable-time" className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" />
            Minimum Billable Time (minutes)
          </Label>
          <Input
            id="minimum-billable-time"
            type="number"
            min="0"
            value={data.minimum_billable_time ?? ''}
            onChange={(event) =>
              updateData({
                minimum_billable_time: Math.max(0, Number(event.target.value) || 0),
              })
            }
            placeholder="15"
          />
          <p className="text-xs text-gray-500">
            e.g., 15 minutes - any time entry less than this will be rounded up
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="round-up-to" className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" />
            Round Up To Nearest (minutes)
          </Label>
          <Input
            id="round-up-to"
            type="number"
            min="0"
            value={data.round_up_to_nearest ?? ''}
            onChange={(event) =>
              updateData({
                round_up_to_nearest: Math.max(0, Number(event.target.value) || 0),
              })
            }
            placeholder="15"
          />
          <p className="text-xs text-gray-500">
            e.g., 15 minutes - time entries will be rounded up to the nearest interval
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <Label className="flex items-center gap-2 font-semibold">
          <Clock className="h-4 w-4" />
          Hourly Services
        </Label>

        {data.hourly_services.map((service, index) => (
          <div
            key={index}
            className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
          >
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                  Service {index + 1}
                </Label>
                <CustomSelect
                  id={`hourly-service-${index}`}
                  value={service.service_id}
                  onValueChange={(value: string) => handleServiceChange(index, value)}
                  options={serviceOptions}
                  placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                  disabled={isLoadingServices}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                  <DollarSign className="h-3 w-3" />
                  Hourly Rate
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id={`hourly-rate-${index}`}
                    type="text"
                    inputMode="decimal"
                    value={rateInputs[index] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setRateInputs((prev) => ({ ...prev, [index]: value }));
                      }
                    }}
                    onBlur={() => {
                      const inputValue = rateInputs[index] ?? '';
                      if (inputValue.trim() === '' || inputValue === '.') {
                        setRateInputs((prev) => ({ ...prev, [index]: '' }));
                        handleRateChange(index, 0);
                      } else {
                        const dollars = parseFloat(inputValue) || 0;
                        const cents = Math.round(dollars * 100);
                        handleRateChange(index, cents);
                        setRateInputs((prev) => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                      }
                    }}
                    placeholder="0.00"
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  {service.hourly_rate
                    ? `${formatCurrency(service.hourly_rate)}/hour`
                    : 'Enter the hourly rate'}
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label="Set bucket of hours"
                  checked={Boolean(service.bucket_overlay)}
                  onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                />
                {service.bucket_overlay && (
                  <BucketOverlayFields
                    mode="hours"
                    value={service.bucket_overlay ?? defaultOverlay(data.hourly_billing_frequency ?? data.billing_frequency)}
                    onChange={(next) => updateBucketOverlay(index, next)}
                    automationId={`hourly-bucket-${index}`}
                    billingFrequency={data.hourly_billing_frequency ?? data.billing_frequency}
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

      {data.hourly_services.length === 0 && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            No hourly services added yet. Click “Add Hourly Service” above or “Skip” if you don’t
            need time & materials billing.
          </p>
        </div>
      )}

      {data.hourly_services.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Hourly Services Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p>
              <strong>Services:</strong> {data.hourly_services.length}
            </p>
            {data.minimum_billable_time !== undefined && (
              <p>
                <strong>Minimum Time:</strong> {data.minimum_billable_time} minutes
              </p>
            )}
            {data.round_up_to_nearest !== undefined && (
              <p>
                <strong>Round Up:</strong> Every {data.round_up_to_nearest} minutes
              </p>
            )}
          </div>
        </div>
      )}

      {data.hourly_services.length > 0 && (
        <BillingFrequencyOverrideSelect
          contractBillingFrequency={data.billing_frequency}
          value={data.hourly_billing_frequency}
          onChange={(value) => updateData({ hourly_billing_frequency: value })}
          label="Alternate Billing Frequency (Optional)"
        />
      )}
    </div>
  );
}
