'use client';

import React, { useState, useEffect } from 'react';
import { BaseServiceConfigPanel } from './BaseServiceConfigPanel';
import { FixedServiceConfigPanel } from './FixedServiceConfigPanel';
import { HourlyServiceConfigPanel } from './HourlyServiceConfigPanel';
import { UsageServiceConfigPanel } from './UsageServiceConfigPanel';
import { BucketServiceConfigPanel } from './BucketServiceConfigPanel';
import { 
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';

interface ServiceConfigurationPanelProps {
  configuration: Partial<IPlanServiceConfiguration>;
  service?: IService;
  typeConfig?: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig> | null;
  rateTiers?: IPlanServiceRateTier[];
  userTypeRates?: IUserTypeRate[];
  onConfigurationChange: (updates: Partial<IPlanServiceConfiguration>) => void;
  onTypeConfigChange: (type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket', config: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>) => void;
  onRateTiersChange?: (tiers: IPlanServiceRateTier[]) => void;
  onUserTypeRatesChange?: (rates: IUserTypeRate[]) => void;
  onSave?: () => void;
  onCancel?: () => void;
  className?: string;
  disabled?: boolean;
  error?: string | null;
  isSubmitting?: boolean;
}

export function ServiceConfigurationPanel({
  configuration,
  service,
  typeConfig,
  rateTiers = [],
  userTypeRates = [],
  onConfigurationChange,
  onTypeConfigChange,
  onRateTiersChange,
  onUserTypeRatesChange,
  onSave,
  onCancel,
  className = '',
  disabled = false,
  error = null,
  isSubmitting = false
}: ServiceConfigurationPanelProps) {
  const [configurationType, setConfigurationType] = useState<'Fixed' | 'Hourly' | 'Usage' | 'Bucket'>(
    configuration.configuration_type || 'Fixed'
  );
  const [fixedConfig, setFixedConfig] = useState<Partial<IPlanServiceFixedConfig>>(
    configurationType === 'Fixed' ? (typeConfig as Partial<IPlanServiceFixedConfig>) || {} : {}
  );
  const [hourlyConfig, setHourlyConfig] = useState<Partial<IPlanServiceHourlyConfig>>(
    configurationType === 'Hourly' ? (typeConfig as Partial<IPlanServiceHourlyConfig>) || {} : {}
  );
  const [usageConfig, setUsageConfig] = useState<Partial<IPlanServiceUsageConfig>>(
    configurationType === 'Usage' ? (typeConfig as Partial<IPlanServiceUsageConfig>) || {} : {}
  );
  const [bucketConfig, setBucketConfig] = useState<Partial<IPlanServiceBucketConfig>>(
    configurationType === 'Bucket' ? (typeConfig as Partial<IPlanServiceBucketConfig>) || {} : {}
  );

  // Update local state when props change
  useEffect(() => {
    setConfigurationType(configuration.configuration_type || 'Fixed');
    
    if (typeConfig) {
      switch (configuration.configuration_type) {
        case 'Fixed':
          setFixedConfig(typeConfig as Partial<IPlanServiceFixedConfig>);
          break;
        case 'Hourly':
          setHourlyConfig(typeConfig as Partial<IPlanServiceHourlyConfig>);
          break;
        case 'Usage':
          setUsageConfig(typeConfig as Partial<IPlanServiceUsageConfig>);
          break;
        case 'Bucket':
          setBucketConfig(typeConfig as Partial<IPlanServiceBucketConfig>);
          break;
      }
    }
  }, [configuration, typeConfig]);

  const handleConfigurationChange = (updates: Partial<IPlanServiceConfiguration>) => {
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

  const handleFixedConfigChange = (updates: Partial<IPlanServiceFixedConfig>) => {
    const updatedConfig = { ...fixedConfig, ...updates };
    setFixedConfig(updatedConfig);
    onTypeConfigChange('Fixed', updatedConfig);
  };

  const handleHourlyConfigChange = (updates: Partial<IPlanServiceHourlyConfig>) => {
    const updatedConfig = { ...hourlyConfig, ...updates };
    setHourlyConfig(updatedConfig);
    onTypeConfigChange('Hourly', updatedConfig);
  };

  const handleUsageConfigChange = (updates: Partial<IPlanServiceUsageConfig>) => {
    const updatedConfig = { ...usageConfig, ...updates };
    setUsageConfig(updatedConfig);
    onTypeConfigChange('Usage', updatedConfig);
  };

  const handleBucketConfigChange = (updates: Partial<IPlanServiceBucketConfig>) => {
    const updatedConfig = { ...bucketConfig, ...updates };
    setBucketConfig(updatedConfig);
    onTypeConfigChange('Bucket', updatedConfig);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
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
          onConfigurationChange={handleFixedConfigChange}
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
        />
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