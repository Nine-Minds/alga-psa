'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Activity, DollarSign } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../BucketOverlayFields';

interface UsageBasedServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function UsageBasedServicesStep({ data, updateData }: UsageBasedServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    // Initialize rate inputs from data
    const inputs: Record<number, string> = {};
    data.usage_services?.forEach((service, index) => {
      if (service.unit_rate !== undefined) {
        inputs[index] = (service.unit_rate / 100).toFixed(2);
      }
    });
    setRateInputs(inputs);
  }, [data.usage_services]);

  const loadServices = async () => {
    try {
      const result = await getServices();
      if (result && Array.isArray(result.services)) {
        setServices(result.services);
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
        unit_rate: undefined,
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
      unit_rate: service?.default_rate || undefined,
      unit_of_measure: service?.unit_of_measure || 'unit'
    };
    updateData({ usage_services: newServices });
  };

  const handleRateChange = (index: number, rate: number) => {
    const newServices = [...(data.usage_services || [])];
    newServices[index] = { ...newServices[index], unit_rate: rate };
    updateData({ usage_services: newServices });
  };

  const handleUnitChange = (index: number, unit: string) => {
    const newServices = [...(data.usage_services || [])];
    newServices[index] = { ...newServices[index], unit_of_measure: unit };
    updateData({ usage_services: newServices });
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
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
          Configure services that are billed based on usage or consumption. Perfect for metered services like data transfer, API calls, or storage.
        </p>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800">
          <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics.
          Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.
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
                <Label htmlFor={`usage-service-${index}`} className="text-sm">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor={`unit-rate-${index}`} className="text-sm flex items-center gap-2">
                    <DollarSign className="h-3 w-3" />
                    Rate per Unit
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id={`unit-rate-${index}`}
                      type="text"
                      inputMode="decimal"
                      value={rateInputs[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        // Allow only one decimal point
                        const decimalCount = (value.match(/\./g) || []).length;
                        if (decimalCount <= 1) {
                          setRateInputs(prev => ({ ...prev, [index]: value }));
                        }
                      }}
                      onBlur={() => {
                        const inputValue = rateInputs[index] || '';
                        if (inputValue.trim() === '' || inputValue === '.') {
                          setRateInputs(prev => ({ ...prev, [index]: '' }));
                          handleRateChange(index, 0);
                        } else {
                          const dollars = parseFloat(inputValue) || 0;
                          const cents = Math.round(dollars * 100);
                          handleRateChange(index, cents);
                          setRateInputs(prev => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                        }
                      }}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {service.unit_rate ? `${formatCurrency(service.unit_rate)}/${service.unit_of_measure || 'unit'}` : 'Enter unit rate'}
                  </p>
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
                    e.g., GB, API call, transaction
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label="Include bucket allocation"
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
                service.unit_rate && (
                  <p key={idx} className="text-xs">
                    • {service.service_name || `Service ${idx + 1}`}: {formatCurrency(service.unit_rate)}/{service.unit_of_measure || 'unit'}
                  </p>
                )
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
