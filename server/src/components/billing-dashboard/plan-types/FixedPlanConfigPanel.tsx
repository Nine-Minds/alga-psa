'use client'

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';

interface FixedPlanConfigPanelProps {
  baseRate?: number;
  onBaseRateChange: (value: number | undefined) => void;
  enableProration?: boolean;
  onEnableProrateChange?: (value: boolean) => void;
  billingCycleAlignment?: string;
  onBillingCycleAlignmentChange?: (value: string) => void;
  serviceCatalogId?: string;
  onServiceCatalogIdChange?: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function FixedPlanConfigPanel({
  baseRate,
  onBaseRateChange,
  enableProration = false,
  onEnableProrateChange,
  billingCycleAlignment = 'start',
  onBillingCycleAlignmentChange,
  serviceCatalogId,
  onServiceCatalogIdChange,
  className = '',
  disabled = false
}: FixedPlanConfigPanelProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    baseRate?: string;
    serviceCatalogId?: string;
  }>({});

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

    if (onServiceCatalogIdChange) {
      fetchServices();
    }
  }, [onServiceCatalogIdChange]);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      baseRate?: string;
      serviceCatalogId?: string;
    } = {};

    if (baseRate !== undefined && baseRate < 0) {
      errors.baseRate = 'Base rate cannot be negative';
    }

    if (onServiceCatalogIdChange && !serviceCatalogId) {
      errors.serviceCatalogId = 'Please select a service';
    }

    setValidationErrors(errors);
  }, [baseRate, serviceCatalogId, onServiceCatalogIdChange]);

  const handleBaseRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    onBaseRateChange(value);
  };

  const alignmentOptions = [
    { value: 'start', label: 'Start of Billing Cycle' },
    { value: 'end', label: 'End of Billing Cycle' },
    { value: 'calendar', label: 'Calendar Month' },
    { value: 'anniversary', label: 'Anniversary Date' }
  ];

  const serviceOptions = services.map(service => ({
    value: service.service_id,
    label: service.service_name
  }));

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Fixed Plan Configuration</h3>
        
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <div className="grid gap-4">
          <div>
            <Label htmlFor="fixed-plan-base-rate">Base Rate</Label>
            <Input
              id="fixed-plan-base-rate"
              type="number"
              value={baseRate?.toString() || ''}
              onChange={handleBaseRateChange}
              placeholder="Enter base rate"
              disabled={disabled}
              min={0}
              step={0.01}
              className={validationErrors.baseRate ? 'border-red-500' : ''}
            />
            {validationErrors.baseRate ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.baseRate}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The base rate for this fixed plan
              </p>
            )}
          </div>

          {onEnableProrateChange && (
            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="fixed-plan-enable-proration"
                checked={enableProration}
                onCheckedChange={onEnableProrateChange}
                disabled={disabled}
              />
              <Label htmlFor="fixed-plan-enable-proration" className="cursor-pointer">
                Enable Proration
              </Label>
            </div>
          )}

          {enableProration && onBillingCycleAlignmentChange && (
            <div className="pl-6 border-l-2 border-gray-200">
              <Label htmlFor="fixed-plan-billing-cycle-alignment">Billing Cycle Alignment</Label>
              <CustomSelect
                id="fixed-plan-billing-cycle-alignment"
                options={alignmentOptions}
                onValueChange={onBillingCycleAlignmentChange}
                value={billingCycleAlignment}
                placeholder="Select alignment"
                className="w-full"
                disabled={disabled}
              />
              <p className="text-sm text-gray-500 mt-1">
                Determines how partial periods are calculated
              </p>
            </div>
          )}

          {onServiceCatalogIdChange && (
            <div>
              <Label htmlFor="fixed-plan-service">Service</Label>
              <CustomSelect
                id="fixed-plan-service"
                options={serviceOptions}
                onValueChange={onServiceCatalogIdChange}
                value={serviceCatalogId}
                placeholder={loading ? "Loading services..." : "Select a service"}
                className="w-full"
                disabled={disabled || loading || services.length === 0}
              />
              {validationErrors.serviceCatalogId ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.serviceCatalogId}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  The service associated with this fixed plan
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}