'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Package, HelpCircle, Coins } from 'lucide-react';
import { getCurrencySymbol } from 'server/src/constants/currency';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../BucketOverlayFields';
import { BillingFrequencyOverrideSelect } from '../BillingFrequencyOverrideSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [baseRateInput, setBaseRateInput] = useState<string>('');

  useEffect(() => {
    const loadServices = async () => {
      try {
        const result = await getServices(1, 999, { item_kind: 'service' });
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

    void loadServices();
  }, []);

  useEffect(() => {
    if (data.fixed_base_rate !== undefined) {
      setBaseRateInput((data.fixed_base_rate / 100).toFixed(2));
    }
  }, [data.fixed_base_rate]);

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
      service_name: service?.service_name || '',
    };
    updateData({ fixed_services: next });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], quantity };
    updateData({ fixed_services: next });
  };

  const currencySymbol = getCurrencySymbol(data.currency_code);

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return `${currencySymbol}0.00`;
    return `${currencySymbol}${(cents / 100).toFixed(2)}`;
  };

  const getDefaultOverlay = (): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.fixed_services];
    if (enabled) {
      const existing = next[index].bucket_overlay;
      next[index] = {
        ...next[index],
        bucket_overlay: existing ? { ...existing } : getDefaultOverlay(),
      };
    } else {
      next[index] = {
        ...next[index],
        bucket_overlay: undefined,
      };
    }
    updateData({ fixed_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const next = [...data.fixed_services];
    next[index] = {
      ...next[index],
      bucket_overlay: { ...overlay },
    };
    updateData({ fixed_services: next });
  };

  return (
    <ReflectionContainer id="fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Fixed Fee Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed at a fixed rate each billing cycle. You can still
            track time, but billing is based on this flat amount.
          </p>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>What are Fixed Fee Services?</strong> These services have a set recurring price. You'll still track time entries for these services, but billing is based on the fixed rate, not hours worked.
          </p>
        </div>

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="fixed_base_rate" className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Recurring Base Rate *
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                {currencySymbol}
              </span>
              <Input
                id="fixed_base_rate"
                type="text"
                inputMode="decimal"
                value={baseRateInput}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^0-9.]/g, '');
                  const decimalCount = (value.match(/\./g) || []).length;
                  if (decimalCount <= 1) {
                    setBaseRateInput(value);
                  }
                }}
                onBlur={() => {
                  if (baseRateInput.trim() === '' || baseRateInput === '.') {
                    setBaseRateInput('');
                    updateData({ fixed_base_rate: undefined });
                  } else {
                    const dollars = parseFloat(baseRateInput) || 0;
                    const cents = Math.round(dollars * 100);
                    updateData({ fixed_base_rate: cents });
                    setBaseRateInput((cents / 100).toFixed(2));
                  }
                }}
                placeholder="0.00"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-gray-500">
              Total recurring fee for all fixed services combined.
            </p>
          </div>
        )}

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SwitchWithLabel
                label="Enable proration"
                checked={data.enable_proration}
                onCheckedChange={(checked) => updateData({ enable_proration: checked })}
              />
              <Tooltip content="Automatically adjust the recurring fee for partial billing periods based on the contract start and end dates.">
                <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
              </Tooltip>
            </div>
            <p className="text-xs text-gray-500">
              When enabled, the recurring fee is prorated if the contract starts or ends mid-cycle.
            </p>
          </div>
        )}

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
                  <Label htmlFor={`service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`service-select-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
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
                    onChange={(event) =>
                      handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                    }
                    min="1"
                    className="w-24"
                  />
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

        {data.fixed_services.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No fixed fee services added yet. Click “Add Service” above or “Skip” to move on.
            </p>
          </div>
        )}

        {data.fixed_services.length > 0 && data.fixed_base_rate && (
          <Alert variant="info" className="mt-6">
            <AlertDescription>
              <h4 className="text-sm font-semibold mb-2">Fixed Fee Summary</h4>
              <div className="text-sm space-y-1">
                <p>
                  <strong>Services:</strong> {data.fixed_services.length}
                </p>
                <p>
                  <strong>Recurring Rate:</strong> {formatCurrency(data.fixed_base_rate)}
                </p>
                <p>
                  <strong>Proration:</strong> {data.enable_proration ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {data.fixed_services.length > 0 && (
          <BillingFrequencyOverrideSelect
            contractBillingFrequency={data.billing_frequency}
            value={data.fixed_billing_frequency}
            onChange={(value) => updateData({ fixed_billing_frequency: value })}
            label="Alternate Billing Frequency (Optional)"
          />
        )}
      </div>
    </ReflectionContainer>
  );
}
