'use client';

import React, { useState, useEffect } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ContractWizardData } from '../ContractWizard';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Plus, X, Droplet, DollarSign, Clock, TrendingUp } from 'lucide-react';

interface BucketHoursStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function BucketHoursStep({ data, updateData }: BucketHoursStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [monthlyFeeInput, setMonthlyFeeInput] = useState<string>('');
  const [overageRateInput, setOverageRateInput] = useState<string>('');

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    // Initialize monthly fee input from data
    if (data.bucket_monthly_fee !== undefined) {
      setMonthlyFeeInput((data.bucket_monthly_fee / 100).toFixed(2));
    }
  }, [data.bucket_monthly_fee]);

  useEffect(() => {
    // Initialize overage rate input from data
    if (data.bucket_overage_rate !== undefined) {
      setOverageRateInput((data.bucket_overage_rate / 100).toFixed(2));
    }
  }, [data.bucket_overage_rate]);

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
      bucket_services: [...data.bucket_services, { service_id: '', service_name: '' }]
    });
  };

  const handleRemoveService = (index: number) => {
    const newServices = data.bucket_services.filter((_, i) => i !== index);
    updateData({ bucket_services: newServices });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find(s => s.service_id === serviceId);
    const newServices = [...data.bucket_services];
    newServices[index] = {
      service_id: serviceId,
      service_name: service?.service_name || ''
    };
    updateData({ bucket_services: newServices });
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const calculateEffectiveRate = () => {
    if (!data.bucket_hours || !data.bucket_monthly_fee) return 0;
    return data.bucket_monthly_fee / data.bucket_hours;
  };

  const effectiveRate = calculateEffectiveRate();

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Bucket Hours</h3>
        <p className="text-sm text-gray-600">
          Set up a pre-paid hours pool with overage billing. Also known as "hours per period" or "block hours".
        </p>
      </div>

      {/* Info Box with Example */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md space-y-2">
        <p className="text-sm text-amber-800">
          <strong>How Bucket Hours Work:</strong>
        </p>
        <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 ml-2">
          <li>Client pays a fixed monthly fee for a certain number of hours</li>
          <li>Hours are "filled into the bucket" as time is tracked</li>
          <li>Once the bucket is full, additional hours are billed at the overage rate</li>
          <li>Great for clients who want predictable monthly costs with flexibility</li>
        </ul>
        <div className="mt-3 p-3 bg-amber-100 rounded text-xs text-amber-900">
          <strong>Example:</strong> 40 hours/month @ $5,000 = $125/hour effective rate.<br/>
          If they use 45 hours, they pay $5,000 + (5 hours × $150 overage rate) = $5,750
        </div>
      </div>

      {/* Bucket Configuration */}
      <div className="space-y-4">
        {/* Hours Per Period */}
        <div className="space-y-2">
          <Label htmlFor="bucket_hours" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Hours Per Period (Month)
          </Label>
          <Input
            id="bucket_hours"
            type="number"
            value={data.bucket_hours || ''}
            onChange={(e) => updateData({ bucket_hours: parseInt(e.target.value) || undefined })}
            placeholder="40"
            min="1"
            step="1"
            className="w-32"
          />
          <p className="text-xs text-gray-500">
            How many hours are included in the monthly bucket?
          </p>
        </div>

        {/* Monthly Fee */}
        <div className="space-y-2">
          <Label htmlFor="bucket_monthly_fee" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Monthly Fee
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="bucket_monthly_fee"
              type="text"
              inputMode="decimal"
              value={monthlyFeeInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                // Allow only one decimal point
                const decimalCount = (value.match(/\./g) || []).length;
                if (decimalCount <= 1) {
                  setMonthlyFeeInput(value);
                }
              }}
              onBlur={() => {
                if (monthlyFeeInput.trim() === '' || monthlyFeeInput === '.') {
                  setMonthlyFeeInput('');
                  updateData({ bucket_monthly_fee: undefined });
                } else {
                  const dollars = parseFloat(monthlyFeeInput) || 0;
                  const cents = Math.round(dollars * 100);
                  updateData({ bucket_monthly_fee: cents });
                  setMonthlyFeeInput((cents / 100).toFixed(2));
                }
              }}
              placeholder="0.00"
              className="pl-7 w-48"
            />
          </div>
          <p className="text-xs text-gray-500">
            Fixed monthly price for the bucket hours
          </p>
        </div>

        {/* Effective Rate Display */}
        {data.bucket_hours && data.bucket_monthly_fee && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-800">
              <strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/hour
              <span className="text-xs ml-2">({formatCurrency(data.bucket_monthly_fee)} ÷ {data.bucket_hours} hours)</span>
            </p>
          </div>
        )}

        {/* Overage Rate */}
        <div className="space-y-2">
          <Label htmlFor="bucket_overage_rate" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Overage Rate (per hour)
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="bucket_overage_rate"
              type="text"
              inputMode="decimal"
              value={overageRateInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                // Allow only one decimal point
                const decimalCount = (value.match(/\./g) || []).length;
                if (decimalCount <= 1) {
                  setOverageRateInput(value);
                }
              }}
              onBlur={() => {
                if (overageRateInput.trim() === '' || overageRateInput === '.') {
                  setOverageRateInput('');
                  updateData({ bucket_overage_rate: undefined });
                } else {
                  const dollars = parseFloat(overageRateInput) || 0;
                  const cents = Math.round(dollars * 100);
                  updateData({ bucket_overage_rate: cents });
                  setOverageRateInput((cents / 100).toFixed(2));
                }
              }}
              placeholder="0.00"
              className="pl-7 w-48"
            />
          </div>
          <p className="text-xs text-gray-500">
            Hourly rate for hours exceeding the bucket
          </p>
        </div>
      </div>

      {/* Services Included in Bucket */}
      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Droplet className="h-4 w-4" />
          Services Included in Bucket
        </Label>
        <p className="text-xs text-gray-600 -mt-2">
          Select which services count toward bucket hour usage
        </p>

        {data.bucket_services.map((service, index) => (
          <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
            <div className="flex-1">
              <Label htmlFor={`bucket-service-${index}`} className="text-sm mb-2">
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

            <Button
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
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
          disabled={!data.bucket_hours || !data.bucket_monthly_fee || !data.bucket_overage_rate}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Service to Bucket
        </Button>
      </div>

      {/* Skip hint */}
      {!data.bucket_hours && !data.bucket_monthly_fee && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            Bucket hours not configured. Fill in the hours, monthly fee, and overage rate above, or click "Skip" to move on.
          </p>
        </div>
      )}

      {/* Summary */}
      {data.bucket_hours && data.bucket_monthly_fee && data.bucket_overage_rate && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Bucket Hours Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Hours/Month:</strong> {data.bucket_hours} hours</p>
            <p><strong>Monthly Fee:</strong> {formatCurrency(data.bucket_monthly_fee)}</p>
            <p><strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/hour</p>
            <p><strong>Overage Rate:</strong> {formatCurrency(data.bucket_overage_rate)}/hour</p>
            <p><strong>Services:</strong> {data.bucket_services.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}