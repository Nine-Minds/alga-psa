'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, DollarSign, Package, HelpCircle } from 'lucide-react';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [baseRateInput, setBaseRateInput] = useState<string>('');

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    // Initialize input from data
    if (data.fixed_base_rate !== undefined) {
      setBaseRateInput((data.fixed_base_rate / 100).toFixed(2));
    }
  }, [data.fixed_base_rate]);

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

  return (
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
          <strong>What are Fixed Fee Services?</strong> These services have a set monthly price. You'll still track time entries
          for these services, but billing is based on the fixed rate, not hours worked.
        </p>
      </div>

      {/* Monthly Base Rate */}
      {data.fixed_services.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="fixed_base_rate" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Monthly Base Rate *
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="fixed_base_rate"
              type="text"
              inputMode="decimal"
              value={baseRateInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                // Allow only one decimal point
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
            The total monthly fee for all fixed services combined
          </p>
        </div>
      )}

      {/* Proration Toggle */}
      {data.fixed_services.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SwitchWithLabel
              label="Enable Proration"
              checked={data.enable_proration}
              onCheckedChange={(checked) => updateData({ enable_proration: checked })}
            />
            <Tooltip content="Proration automatically adjusts the monthly fee for partial months. For example, if a contract starts mid-month, the client is only charged for the days active that month.">
              <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xs text-gray-500">
            When enabled, the monthly fee will be prorated for partial months based on the start/end date
          </p>
        </div>
      )}

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

      {/* Summary */}
      {data.fixed_services.length > 0 && data.fixed_base_rate && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Fixed Fee Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Services:</strong> {data.fixed_services.length}</p>
            <p><strong>Monthly Rate:</strong> {formatCurrency(data.fixed_base_rate)}</p>
            <p><strong>Proration:</strong> {data.enable_proration ? 'Enabled' : 'Disabled'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
