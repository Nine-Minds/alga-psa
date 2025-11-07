'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Package, DollarSign } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { TemplateWizardData } from '../TemplateWizard';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

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
  const [baseRateInput, setBaseRateInput] = useState<string>('');

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
        { service_id: '', service_name: '', quantity: 1 },
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

  // Build preview services list
  const previewServices = React.useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      quantity?: number;
      serviceId: string;
    }> = [];

    // Add individual services
    for (const service of data.fixed_services) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          quantity: service.quantity ?? 1,
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.fixed_services]);

  const handlePreviewQuantityChange = (itemId: string, quantity: number) => {
    if (itemId.startsWith('service-')) {
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.fixed_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleQuantityChange(serviceIndex, quantity);
      }
    }
  };

  const handlePreviewRemoveService = (itemId: string) => {
    if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.fixed_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Fixed Fee Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed at a fixed rate each billing cycle. You can still track time, but billing is based on this flat amount.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md">
          <p className="text-sm text-accent-900">
            <strong>What are Fixed Fee Services?</strong> These services have a set recurring price. You'll still track time entries for these services, but billing is based on the fixed rate, not hours worked.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="fixed"
          onQuantityChange={handlePreviewQuantityChange}
          onRemoveService={handlePreviewRemoveService}
        />

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="fixed_base_rate" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Recurring Base Rate (Optional)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
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
                className="pl-7"
              />
            </div>
            <p className="text-xs text-gray-500">
              Suggested total recurring fee for all fixed services combined.
            </p>
          </div>
        )}

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <SwitchWithLabel
              label="Enable proration (Optional)"
              checked={data.enable_proration ?? false}
              onCheckedChange={(checked) => updateData({ enable_proration: checked })}
            />
            <p className="text-xs text-gray-500">
              When enabled, suggests that the recurring fee should be prorated if the contract starts or ends mid-cycle.
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
                    Quantity (Optional)
                  </Label>
                  <Input
                    id={`template-fixed-quantity-${index}`}
                    type="number"
                    min="1"
                    value={service.quantity ?? 1}
                    onChange={(event) =>
                      handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                    }
                    className="w-24"
                  />
                  <p className="text-xs text-gray-500">Suggested quantity when creating contracts</p>
                </div>
              </div>

              <Button
                id={`template-fixed-remove-service-${index}`}
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
            id="template-fixed-add-service"
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
