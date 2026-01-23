'use client'

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { IContractLineServiceConfiguration } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
import { ConfigurationTypeSelector } from './ConfigurationTypeSelector';

interface BaseServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceConfiguration>;
  service?: IService;
  onConfigurationChange: (updates: Partial<IContractLineServiceConfiguration>) => void;
  onTypeChange?: (type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => void;
  showTypeSelector?: boolean;
  className?: string;
  disabled?: boolean;
  error?: string | null;
}

export function BaseServiceConfigPanel({
  configuration,
  service,
  onConfigurationChange,
  onTypeChange,
  showTypeSelector = true,
  className = '',
  disabled = false,
  error = null
}: BaseServiceConfigPanelProps) {
  const [validationErrors, setValidationErrors] = useState<{
    custom_rate?: string;
    quantity?: string;
  }>({});

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      custom_rate?: string;
      quantity?: string;
    } = {};

    if (configuration.custom_rate != null && configuration.custom_rate < 0) {
      errors.custom_rate = 'Rate cannot be negative';
    }

    if (configuration.quantity !== undefined && configuration.quantity < 0) {
      errors.quantity = 'Quantity cannot be negative';
    }

    setValidationErrors(errors);
  }, [configuration.custom_rate, configuration.quantity]);

  const handleCustomRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? null : Number(e.target.value); // Handle as decimal
    onConfigurationChange({ custom_rate: value });
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    onConfigurationChange({ quantity: value });
  };

  const handleTypeChange = (type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => {
    if (onTypeChange) {
      onTypeChange(type);
    }
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-md font-medium">Service Configuration</h3>
          {service && (
            <div className="text-sm text-gray-500">
              Service: <span className="font-medium">{service.service_name}</span>
            </div>
          )}
        </div>
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {showTypeSelector && onTypeChange && (
          <div>
            <Label>Configuration Type</Label>
            <ConfigurationTypeSelector
              value={configuration.configuration_type || 'Fixed'}
              onChange={handleTypeChange}
              disabled={disabled}
              showWarningOnChange={!!configuration.config_id}
            />
          </div>
        )}
        
        <div className={`grid gap-4 ${configuration.configuration_type !== 'Hourly' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {/* Quantity - only shown for Fixed and Usage (not used in Hourly billing) */}
          {configuration.configuration_type !== 'Hourly' && (
            <div>
              <Label htmlFor="service-quantity">Quantity</Label>
              <Input
                id="service-quantity"
                type="number"
                value={configuration.quantity?.toString() || ''}
                onChange={handleQuantityChange}
                placeholder="Enter quantity"
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.quantity ? 'border-red-500' : ''}
              />
              {validationErrors.quantity ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.quantity}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  Number of units of this service
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="service-custom-rate">Custom Rate</Label>
            <Input
              id="service-custom-rate"
              type="number"
              value={configuration.custom_rate == null ? '' : configuration.custom_rate.toString()} // Display as decimal
              onChange={handleCustomRateChange}
              placeholder={service?.default_rate !== undefined ? `Default: ${service.default_rate.toFixed(2)}` : 'Enter rate'} // Display default as decimal
              disabled={disabled}
              min={0}
              step={0.01}
              className={validationErrors.custom_rate ? 'border-red-500' : ''}
            />
            {validationErrors.custom_rate ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.custom_rate}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                {service?.default_rate !== undefined
                  ? `Leave blank to use default rate (${service.default_rate.toFixed(2)})` // Display default as decimal
                  : 'Custom rate for this service'}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
