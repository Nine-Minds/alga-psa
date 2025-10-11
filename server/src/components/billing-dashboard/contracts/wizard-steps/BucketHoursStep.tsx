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
import { Plus, X, Droplet, DollarSign, Clock, TrendingUp, HelpCircle } from 'lucide-react';

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
    if (data.bucket_monthly_fee !== undefined) {
      setMonthlyFeeInput((data.bucket_monthly_fee / 100).toFixed(2));
    }
  }, [data.bucket_monthly_fee]);

  useEffect(() => {
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
    if (!data.bucket_monthly_fee) return 0;

    if (data.bucket_type === 'hours' && data.bucket_hours) {
      return data.bucket_monthly_fee / data.bucket_hours;
    } else if (data.bucket_type === 'usage' && data.bucket_usage_units) {
      return data.bucket_monthly_fee / data.bucket_usage_units;
    }

    return 0;
  };

  const effectiveRate = calculateEffectiveRate();

  const getBucketQuantity = () => {
    if (data.bucket_type === 'hours') return data.bucket_hours;
    if (data.bucket_type === 'usage') return data.bucket_usage_units;
    return 0;
  };

  const getBucketUnitLabel = () => {
    if (data.bucket_type === 'hours') return 'hour';
    if (data.bucket_type === 'usage') return data.bucket_unit_of_measure || 'unit';
    return 'unit';
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Bucket Services</h3>
        <p className="text-sm text-gray-600">
          Set up a pre-paid pool of hours or usage units with overage billing. Also known as "bucket hours", "hours per period" or "block hours/units".
        </p>
      </div>

      {/* Info Box with Example */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md space-y-2">
        <p className="text-sm text-amber-800">
          <strong>How Bucket Services Work:</strong>
        </p>
        <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 ml-2">
          <li>Client pays a fixed monthly fee for a certain number of hours or usage units</li>
          <li>Usage is "filled into the bucket" as time is tracked or units are consumed</li>
          <li>Once the bucket is full, additional usage is billed at the overage rate</li>
          <li>Great for clients who want predictable monthly costs with flexibility</li>
        </ul>
        <div className="mt-3 p-3 bg-amber-100 rounded text-xs text-amber-900">
          <strong>Example:</strong> 40 hours/month @ $5,000 = $125/hour effective rate.<br/>
          If they use 45 hours, they pay $5,000 + (5 hours × $150 overage rate) = $5,750
        </div>
      </div>

      {/* Bucket Configuration */}
      <div className="space-y-4">
        {/* Bucket Type Selector */}
        <div className="space-y-2">
          <Label htmlFor="bucket_type" className="flex items-center gap-2">
            <Droplet className="h-4 w-4" />
            Bucket Type
          </Label>
          <CustomSelect
            value={data.bucket_type || ''}
            onValueChange={(value: string) => {
              updateData({
                bucket_type: value as 'hours' | 'usage',
                bucket_hours: value === 'hours' ? data.bucket_hours : undefined,
                bucket_usage_units: value === 'usage' ? data.bucket_usage_units : undefined,
                bucket_unit_of_measure: value === 'usage' ? data.bucket_unit_of_measure : undefined,
              });
            }}
            options={[
              { value: 'hours', label: 'Time-based (Hours)' },
              { value: 'usage', label: 'Usage-based (Units)' }
            ]}
            placeholder="Select bucket type"
            className="w-64"
          />
          <p className="text-xs text-gray-500">
            Choose whether this bucket tracks hours or usage units
          </p>
        </div>

        {/* Hours Per Period - Only show if hours type selected */}
        {data.bucket_type === 'hours' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="bucket_hours" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Hours Per Period (Month)
              </Label>
              <Tooltip content="The number of hours included in the monthly fee. Once these hours are used, any additional time is billed at the overage rate.">
                <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
              </Tooltip>
            </div>
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
        )}

        {/* Usage Units - Only show if usage type selected */}
        {data.bucket_type === 'usage' && (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="bucket_usage_units" className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Usage Units Per Period (Month)
                </Label>
                <Tooltip content="The number of usage units included in the monthly fee. Once these units are used, any additional usage is billed at the overage rate.">
                  <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <Input
                id="bucket_usage_units"
                type="number"
                value={data.bucket_usage_units || ''}
                onChange={(e) => updateData({ bucket_usage_units: parseInt(e.target.value) || undefined })}
                placeholder="1000"
                min="1"
                step="1"
                className="w-32"
              />
              <p className="text-xs text-gray-500">
                How many usage units are included in the monthly bucket?
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bucket_unit_of_measure" className="flex items-center gap-2">
                Unit of Measure
              </Label>
              <Input
                id="bucket_unit_of_measure"
                type="text"
                value={data.bucket_unit_of_measure || ''}
                onChange={(e) => updateData({ bucket_unit_of_measure: e.target.value || undefined })}
                placeholder="e.g., API calls, GB, transactions"
                className="w-64"
              />
              <p className="text-xs text-gray-500">
                What unit are you measuring? (e.g., API calls, gigabytes, transactions)
              </p>
            </div>
          </>
        )}

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
        {getBucketQuantity() && data.bucket_monthly_fee && data.bucket_type && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-800">
              <strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/{getBucketUnitLabel()}
              <span className="text-xs ml-2">
                ({formatCurrency(data.bucket_monthly_fee)} ÷ {getBucketQuantity()} {getBucketUnitLabel()}s)
              </span>
            </p>
          </div>
        )}

        {/* Overage Rate */}
        <div className="space-y-2">
          <Label htmlFor="bucket_overage_rate" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Overage Rate {data.bucket_type ? `(per ${getBucketUnitLabel()})` : ''}
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
            {data.bucket_type === 'hours'
              ? 'Hourly rate for hours exceeding the bucket'
              : data.bucket_type === 'usage'
              ? `Rate per ${getBucketUnitLabel()} for usage exceeding the bucket`
              : 'Rate for usage exceeding the bucket'}
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
          Select which services count toward bucket usage (hours or units)
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
          disabled={!data.bucket_type || !getBucketQuantity() || !data.bucket_monthly_fee || !data.bucket_overage_rate}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Service to Bucket
        </Button>
      </div>

      {/* Skip hint */}
      {!data.bucket_type && !data.bucket_monthly_fee && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-600 text-center">
            Bucket services not configured. Select a bucket type and fill in the required fields above, or click "Skip" to move on.
          </p>
        </div>
      )}

      {/* Summary */}
      {data.bucket_type && getBucketQuantity() && data.bucket_monthly_fee && data.bucket_overage_rate && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Bucket Services Summary</h4>
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>Type:</strong> {data.bucket_type === 'hours' ? 'Time-based (Hours)' : `Usage-based (${data.bucket_unit_of_measure || 'Units'})`}</p>
            <p><strong>Quantity/Month:</strong> {getBucketQuantity()} {getBucketUnitLabel()}s</p>
            <p><strong>Monthly Fee:</strong> {formatCurrency(data.bucket_monthly_fee)}</p>
            <p><strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/{getBucketUnitLabel()}</p>
            <p><strong>Overage Rate:</strong> {formatCurrency(data.bucket_overage_rate)}/{getBucketUnitLabel()}</p>
            <p><strong>Services:</strong> {data.bucket_services.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}
