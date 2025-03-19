'use client'

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card } from 'server/src/components/ui/Card';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface BucketPlanConfigPanelProps {
  totalHours: number;
  onTotalHoursChange: (value: number) => void;
  billingPeriod: string;
  onBillingPeriodChange: (value: string) => void;
  overageRate: number;
  onOverageRateChange: (value: number) => void;
  serviceCatalogId?: string;
  onServiceCatalogIdChange?: (value: string) => void;
  allowRollover?: boolean;
  onAllowRolloverChange?: (value: boolean) => void;
  className?: string;
  disabled?: boolean;
  validationErrors?: {
    totalHours?: string;
    billingPeriod?: string;
    overageRate?: string;
    serviceCatalogId?: string;
  };
}

export function BucketPlanConfigPanel({
  totalHours,
  onTotalHoursChange,
  billingPeriod,
  onBillingPeriodChange,
  overageRate,
  onOverageRateChange,
  serviceCatalogId,
  onServiceCatalogIdChange,
  allowRollover = false,
  onAllowRolloverChange,
  className = '',
  disabled = false,
  validationErrors = {}
}: BucketPlanConfigPanelProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localValidationErrors, setLocalValidationErrors] = useState<{
    totalHours?: string;
    overageRate?: string;
    serviceCatalogId?: string;
  }>({});
  
  // Combine local and passed validation errors
  const combinedValidationErrors = {
    ...localValidationErrors,
    ...validationErrors
  };

  // Fetch services for the dropdown
  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      try {
        const fetchedServices = await getServices();
        setServices(fetchedServices);
        setError(null);
      } catch (err) {
        console.error('Error fetching services:', err);
        setError('Failed to load services. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      totalHours?: string;
      overageRate?: string;
      serviceCatalogId?: string;
    } = {};

    if (totalHours <= 0) {
      errors.totalHours = 'Total hours must be greater than zero';
    }

    if (overageRate < 0) {
      errors.overageRate = 'Overage rate cannot be negative';
    }

    if (onServiceCatalogIdChange && !serviceCatalogId) {
      errors.serviceCatalogId = 'Please select a service';
    }

    setLocalValidationErrors(errors);
  }, [totalHours, overageRate, serviceCatalogId, onServiceCatalogIdChange]);

  const handleTotalHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!isNaN(value) && value >= 0) {
      onTotalHoursChange(value);
    }
  };

  const handleOverageRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!isNaN(value) && value >= 0) {
      onOverageRateChange(value);
    }
  };

  const serviceOptions = services.map(service => ({
    value: service.service_id,
    label: service.service_name
  }));

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Bucket Plan Configuration</h3>
        
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <div className="grid gap-4">
          <div>
            <Label htmlFor="bucket-plan-total-hours">Total Hours</Label>
            <Input
              id="bucket-plan-total-hours"
              type="number"
              value={totalHours.toString()}
              onChange={handleTotalHoursChange}
              placeholder="Enter total hours"
              disabled={disabled}
              min={0}
              step={1}
              className={combinedValidationErrors.totalHours ? 'border-red-500' : ''}
            />
            {combinedValidationErrors.totalHours ? (
              <p className="text-sm text-red-500 mt-1">{combinedValidationErrors.totalHours}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The total number of hours included in this bucket plan
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="bucket-plan-billing-period">Billing Period</Label>
            <CustomSelect
              id="bucket-plan-billing-period"
              options={BILLING_FREQUENCY_OPTIONS}
              onValueChange={onBillingPeriodChange}
              value={billingPeriod}
              placeholder="Select billing period"
              className="w-full"
              disabled={disabled}
            />
            <p className="text-sm text-gray-500 mt-1">
              The period over which the bucket hours are allocated
            </p>
          </div>

          <div>
            <Label htmlFor="bucket-plan-overage-rate">Overage Rate</Label>
            <Input
              id="bucket-plan-overage-rate"
              type="number"
              value={overageRate.toString()}
              onChange={handleOverageRateChange}
              placeholder="Enter overage rate"
              disabled={disabled}
              min={0}
              step={0.01}
              className={combinedValidationErrors.overageRate ? 'border-red-500' : ''}
            />
            {combinedValidationErrors.overageRate ? (
              <p className="text-sm text-red-500 mt-1">{combinedValidationErrors.overageRate}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The hourly rate charged for hours used beyond the bucket limit
              </p>
            )}
          </div>

          {onServiceCatalogIdChange && (
            <div>
              <Label htmlFor="bucket-plan-service">Service</Label>
              <CustomSelect
                id="bucket-plan-service"
                options={serviceOptions}
                onValueChange={onServiceCatalogIdChange}
                value={serviceCatalogId}
                placeholder={loading ? "Loading services..." : "Select a service"}
                className={`w-full ${combinedValidationErrors.serviceCatalogId ? 'border-red-500' : ''}`}
                disabled={disabled || loading || services.length === 0}
              />
              {combinedValidationErrors.serviceCatalogId ? (
                <p className="text-sm text-red-500 mt-1">{combinedValidationErrors.serviceCatalogId}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  The service associated with this bucket plan
                </p>
              )}
            </div>
          )}

          {onAllowRolloverChange && (
            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="bucket-plan-rollover"
                checked={allowRollover}
                onCheckedChange={onAllowRolloverChange}
                disabled={disabled}
              />
              <Label htmlFor="bucket-plan-rollover" className="cursor-pointer">
                Allow unused hours to roll over to next period
              </Label>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}