'use client';

import React, { useState, useEffect } from 'react';
import { BaseServiceConfigPanel } from './BaseServiceConfigPanel';
import { FixedServiceConfigPanel } from './FixedServiceConfigPanel';
import { HourlyServiceConfigPanel } from './HourlyServiceConfigPanel';
import { UsageServiceConfigPanel } from './UsageServiceConfigPanel';
import { BucketServiceConfigPanel } from './BucketServiceConfigPanel';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { IService, IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from '../contracts/BucketOverlayFields';
import { BucketOverlayInput } from 'server/src/lib/actions/bucketOverlayActions';

interface ServiceConfigurationPanelProps {
  configuration: Partial<IContractLineServiceConfiguration>;
  service?: IService;
  typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig> | null;
  planFixedConfig?: Partial<IContractLineFixedConfig>;
  rateTiers?: IContractLineServiceRateTier[];
  userTypeRates?: IUserTypeRate[];
  onConfigurationChange: (updates: Partial<IContractLineServiceConfiguration>) => void;
  onTypeConfigChange: (type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket', config: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>) => void;
  onPlanFixedConfigChange?: (updates: Partial<IContractLineFixedConfig>) => void;
  onRateTiersChange?: (tiers: IContractLineServiceRateTier[]) => void;
  onUserTypeRatesChange?: (rates: IUserTypeRate[]) => void;
  onSave?: () => void;
  onCancel?: () => void;
  className?: string;
  disabled?: boolean;
  error?: string | null;
  isSubmitting?: boolean;
  contractLineBillingFrequency?: string;
  // Bucket overlay props
  bucketOverlay?: BucketOverlayInput | null;
  onBucketOverlayChange?: (overlay: BucketOverlayInput | null) => void;
}

export function ServiceConfigurationPanel({
  configuration,
  service,
  typeConfig,
  planFixedConfig = {},
  rateTiers = [],
  userTypeRates = [],
  onConfigurationChange,
  onTypeConfigChange,
  onPlanFixedConfigChange = () => {},
  onRateTiersChange,
  onUserTypeRatesChange,
  onSave,
  onCancel,
  className = '',
  disabled = false,
  error = null,
  isSubmitting = false,
  contractLineBillingFrequency,
  bucketOverlay,
  onBucketOverlayChange
}: ServiceConfigurationPanelProps) {
  const [configurationType, setConfigurationType] = useState<'Fixed' | 'Hourly' | 'Usage' | 'Bucket'>(
    configuration.configuration_type || 'Fixed'
  );
  const [fixedConfig, setFixedConfig] = useState<Partial<IContractLineServiceFixedConfig>>(
    configurationType === 'Fixed' ? (typeConfig as Partial<IContractLineServiceFixedConfig>) || {} : {}
  );
  const [hourlyConfig, setHourlyConfig] = useState<Partial<IContractLineServiceHourlyConfig>>(
    configurationType === 'Hourly' ? (typeConfig as Partial<IContractLineServiceHourlyConfig>) || {} : {}
  );
  const [usageConfig, setUsageConfig] = useState<Partial<IContractLineServiceUsageConfig>>(
    configurationType === 'Usage' ? (typeConfig as Partial<IContractLineServiceUsageConfig>) || {} : {}
  );
  const [bucketConfig, setBucketConfig] = useState<Partial<IContractLineServiceBucketConfig>>(
    configurationType === 'Bucket' ? (typeConfig as Partial<IContractLineServiceBucketConfig>) || {} : {}
  );

  // Update local state when props change
  useEffect(() => {
    setConfigurationType(configuration.configuration_type || 'Fixed');
    
    if (typeConfig) {
      switch (configuration.configuration_type) {
        case 'Fixed':
          setFixedConfig(typeConfig as Partial<IContractLineServiceFixedConfig>);
          break;
        case 'Hourly':
          setHourlyConfig(typeConfig as Partial<IContractLineServiceHourlyConfig>);
          break;
        case 'Usage':
          setUsageConfig(typeConfig as Partial<IContractLineServiceUsageConfig>);
          break;
        case 'Bucket':
          setBucketConfig(typeConfig as Partial<IContractLineServiceBucketConfig>);
          break;
      }
    }
  }, [configuration, typeConfig]);

  const handleConfigurationChange = (updates: Partial<IContractLineServiceConfiguration>) => {
    onConfigurationChange(updates);
  };

  const handleTypeChange = (type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => {
    setConfigurationType(type);
    onConfigurationChange({ configuration_type: type });
    
    // Reset type-specific config when changing types
    switch (type) {
      case 'Fixed':
        onTypeConfigChange(type, fixedConfig);
        break;
      case 'Hourly':
        onTypeConfigChange(type, hourlyConfig);
        break;
      case 'Usage':
        onTypeConfigChange(type, usageConfig);
        break;
      case 'Bucket':
        onTypeConfigChange(type, bucketConfig);
        break;
    }
  };

  const handleFixedConfigChange = (updates: Partial<IContractLineServiceFixedConfig>) => {
    const updatedConfig = { ...fixedConfig, ...updates };
    setFixedConfig(updatedConfig);
    onTypeConfigChange('Fixed', updatedConfig);
  };

  const handleHourlyConfigChange = (updates: Partial<IContractLineServiceHourlyConfig>) => {
    const updatedConfig = { ...hourlyConfig, ...updates };
    setHourlyConfig(updatedConfig);
    onTypeConfigChange('Hourly', updatedConfig);
  };

  const handleUsageConfigChange = (updates: Partial<IContractLineServiceUsageConfig>) => {
    const updatedConfig = { ...usageConfig, ...updates };
    setUsageConfig(updatedConfig);
    onTypeConfigChange('Usage', updatedConfig);
  };

  const handleBucketConfigChange = (updates: Partial<IContractLineServiceBucketConfig>) => {
    const updatedConfig = { ...bucketConfig, ...updates };
    setBucketConfig(updatedConfig);
    onTypeConfigChange('Bucket', updatedConfig);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <BaseServiceConfigPanel
        configuration={configuration}
        service={service}
        onConfigurationChange={handleConfigurationChange}
        onTypeChange={handleTypeChange}
        showTypeSelector={true}
        disabled={disabled}
      />
      
      {configurationType === 'Fixed' && (
        <FixedServiceConfigPanel
          configuration={fixedConfig}
          planFixedConfig={planFixedConfig}
          onConfigurationChange={handleFixedConfigChange}
          onPlanFixedConfigChange={onPlanFixedConfigChange}
          disabled={disabled}
        />
      )}
      
      {configurationType === 'Hourly' && (
        <HourlyServiceConfigPanel
          configuration={hourlyConfig}
          userTypeRates={userTypeRates}
          onConfigurationChange={handleHourlyConfigChange}
          onUserTypeRatesChange={onUserTypeRatesChange}
          disabled={disabled}
        />
      )}
      
      {configurationType === 'Usage' && (
        <UsageServiceConfigPanel
          configuration={usageConfig}
          rateTiers={rateTiers}
          onConfigurationChange={handleUsageConfigChange}
          onRateTiersChange={onRateTiersChange}
          disabled={disabled}
        />
      )}
      
      {configurationType === 'Bucket' && (
        <BucketServiceConfigPanel
          configuration={bucketConfig}
          onConfigurationChange={handleBucketConfigChange}
          disabled={disabled}
          contractLineBillingFrequency={contractLineBillingFrequency}
        />
      )}

      {/* Bucket Overlay Section - Only for Hourly and Usage types */}
      {(configurationType === 'Hourly' || configurationType === 'Usage') && onBucketOverlayChange && (
        <div className="space-y-3 pt-4 border-t border-dashed border-gray-200">
          <SwitchWithLabel
            label={configurationType === 'Hourly' ? 'Recommend bucket of hours' : 'Recommend bucket of consumption'}
            checked={Boolean(bucketOverlay)}
            onCheckedChange={(checked) => {
              if (checked) {
                onBucketOverlayChange({
                  total_minutes: undefined,
                  overage_rate: undefined,
                  allow_rollover: false,
                  billing_period: contractLineBillingFrequency as 'weekly' | 'monthly' || 'monthly'
                });
              } else {
                onBucketOverlayChange(null);
              }
            }}
          />
          {bucketOverlay && (
            <BucketOverlayFields
              mode={configurationType === 'Hourly' ? 'hours' : 'usage'}
              value={bucketOverlay}
              onChange={(overlay) => onBucketOverlayChange(overlay)}
              unitLabel={configurationType === 'Usage' ? service?.unit_of_measure : undefined}
              automationId={`service-config-bucket-overlay`}
              billingFrequency={contractLineBillingFrequency || 'monthly'}
            />
          )}
        </div>
      )}

      {(onSave || onCancel) && (
        <div className="flex justify-end space-x-2 mt-4">
          {onCancel && (
            <Button
              id="cancel-service-config-button"
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          {onSave && (
            <Button
              id="save-service-config-button"
              type="button"
              onClick={onSave}
              disabled={disabled || isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Configuration'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
