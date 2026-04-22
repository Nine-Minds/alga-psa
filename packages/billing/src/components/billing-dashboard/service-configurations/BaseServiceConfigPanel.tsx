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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface BaseServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceConfiguration>;
  service?: IService;
  effectiveMode?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  defaultSource?: 'catalog default' | 'contract override' | 'none';
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
  effectiveMode,
  defaultSource,
  onConfigurationChange,
  onTypeChange,
  showTypeSelector = true,
  className = '',
  disabled = false,
  error = null
}: BaseServiceConfigPanelProps) {
  const { t } = useTranslation('msp/service-catalog');
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
      errors.custom_rate = t('serviceConfig.fields.customRate.errorNegative', {
        defaultValue: 'Rate cannot be negative',
      });
    }

    if (configuration.quantity !== undefined && configuration.quantity < 0) {
      errors.quantity = t('serviceConfig.fields.quantity.errorNegative', {
        defaultValue: 'Quantity cannot be negative',
      });
    }

    setValidationErrors(errors);
  }, [configuration.custom_rate, configuration.quantity, t]);

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

  const formatModeLabel = (mode: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => {
    switch (mode) {
      case 'Fixed':
        return t('serviceConfig.modes.Fixed', { defaultValue: 'Fixed Price' });
      case 'Hourly':
        return t('serviceConfig.modes.Hourly', { defaultValue: 'Hourly Rate' });
      case 'Usage':
        return t('serviceConfig.modes.Usage', { defaultValue: 'Usage-Based' });
      case 'Bucket':
        return t('serviceConfig.modes.Bucket', { defaultValue: 'Bucket Hours' });
    }
  };

  const formatDefaultSource = (
    source: 'catalog default' | 'contract override' | 'none',
  ) => {
    switch (source) {
      case 'catalog default':
        return t('serviceConfig.defaultSources.catalog default', {
          defaultValue: 'catalog default',
        });
      case 'contract override':
        return t('serviceConfig.defaultSources.contract override', {
          defaultValue: 'contract override',
        });
      case 'none':
      default:
        return t('serviceConfig.defaultSources.none', { defaultValue: 'none' });
    }
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-md font-medium">
            {t('serviceConfig.title', { defaultValue: 'Service Configuration' })}
          </h3>
          {service && (
            <div className="text-sm text-muted-foreground">
              {t('serviceConfig.serviceLabel', { defaultValue: 'Service' })}:{' '}
              <span className="font-medium">{service.service_name}</span>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
          <p>
            {t('serviceConfig.effectiveModeLabel', { defaultValue: 'Effective mode' })}:{' '}
            <span className="font-medium text-foreground">
              {formatModeLabel(effectiveMode || configuration.configuration_type || 'Fixed')}
            </span>
          </p>
          <p>
            {t('serviceConfig.defaultSourceLabel', { defaultValue: 'Default source' })}:{' '}
            <span className="font-medium text-foreground">
              {formatDefaultSource(defaultSource || 'none')}
            </span>
          </p>
        </div>
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {showTypeSelector && onTypeChange && (
          <div>
            <Label>
              {t('serviceConfig.fields.configurationType', {
                defaultValue: 'Configuration Type',
              })}
            </Label>
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
              <Label htmlFor="service-quantity">
                {t('serviceConfig.fields.quantity.label', { defaultValue: 'Quantity' })}
              </Label>
              <Input
                id="service-quantity"
                type="number"
                value={configuration.quantity?.toString() || ''}
                onChange={handleQuantityChange}
                placeholder={t('serviceConfig.fields.quantity.placeholder', {
                  defaultValue: 'Enter quantity',
                })}
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.quantity ? 'border-red-500' : ''}
              />
              {validationErrors.quantity ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.quantity}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('serviceConfig.fields.quantity.help', {
                    defaultValue: 'Number of units of this service',
                  })}
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="service-custom-rate">
              {t('serviceConfig.fields.customRate.label', {
                defaultValue: 'Custom Rate',
              })}
            </Label>
            <Input
              id="service-custom-rate"
              type="number"
              value={configuration.custom_rate == null ? '' : configuration.custom_rate.toString()} // Display as decimal
              onChange={handleCustomRateChange}
              placeholder={
                service?.default_rate !== undefined
                  ? t('serviceConfig.fields.customRate.placeholderDefault', {
                      rate: service.default_rate.toFixed(2),
                      defaultValue: 'Default: {{rate}}',
                    })
                  : t('serviceConfig.fields.customRate.placeholder', {
                      defaultValue: 'Enter rate',
                    })
              } // Display default as decimal
              disabled={disabled}
              min={0}
              step={0.01}
              className={validationErrors.custom_rate ? 'border-red-500' : ''}
            />
            {validationErrors.custom_rate ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.custom_rate}</p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                {service?.default_rate !== undefined
                  ? t('serviceConfig.fields.customRate.helpUseDefault', {
                      rate: service.default_rate.toFixed(2),
                      defaultValue: 'Leave blank to use default rate ({{rate}})',
                    })
                  : t('serviceConfig.fields.customRate.helpCustom', {
                      defaultValue: 'Custom rate for this service',
                    })}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
