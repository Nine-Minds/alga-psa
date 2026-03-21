'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { IContractLineService, IService, IContractLineFixedConfig } from '@alga-psa/types';
import { updateContractLineFixedConfig, getContractLineById } from '@alga-psa/billing/actions/contractLineAction';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from '@alga-psa/types';
import { updateContractLineService } from '@alga-psa/billing/actions/contractLineServiceActions';
import {
  getConfigurationForService,
  getConfigurationWithDetails
} from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { ServiceConfigurationPanel } from '../service-configurations/ServiceConfigurationPanel';
import {
  BucketOverlayInput,
  getBucketOverlay,
  upsertBucketOverlay,
  deleteBucketOverlay
} from '../../../actions/bucketOverlayActions';

interface ContractLineServiceFormProps {
  planService: IContractLineService;
  services: IService[]; // services might need updating to include service_type_name if not already done
  // Removed serviceCategories prop
  onClose: () => void;
  onServiceUpdated: () => void;
}

// Removed IServiceCategory import

const ContractLineServiceForm: React.FC<ContractLineServiceFormProps> = ({
  planService,
  services,
  // Removed serviceCategories destructuring
  onClose,
  onServiceUpdated
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [contractLineBillingFrequency, setContractLineBillingFrequency] = useState<string | undefined>(undefined);
  const [contractLineMode, setContractLineMode] = useState<'Fixed' | 'Hourly' | 'Usage' | 'Bucket'>('Fixed');
  const tenant = useTenant()!;

  const service = services.find(s => s.service_id === planService.service_id);
  const mapContractLineTypeToMode = (
    lineType: string | null | undefined
  ): 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' => {
    if (lineType === 'Hourly') return 'Hourly';
    if (lineType === 'Usage') return 'Usage';
    if (lineType === 'Bucket') return 'Bucket';
    return 'Fixed';
  };

  // State for configuration
  const [baseConfig, setBaseConfig] = useState<Partial<IContractLineServiceConfiguration>>({
    contract_line_id: planService.contract_line_id,
    service_id: planService.service_id,
    configuration_type: 'Fixed',
    quantity: planService.quantity || 1,
    custom_rate: planService.custom_rate
  });

  const [typeConfig, setTypeConfig] = useState<Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig> | null>(null);
  const [planFixedConfig, setPlanFixedConfig] = useState<Partial<IContractLineFixedConfig>>({
    enable_proration: false,
    billing_cycle_alignment: 'start'
  });
  const [rateTiers, setRateTiers] = useState<IContractLineServiceRateTier[]>([]);
  const [userTypeRates, setUserTypeRates] = useState<IUserTypeRate[]>([]);

  // Bucket overlay state
  const [bucketOverlay, setBucketOverlay] = useState<BucketOverlayInput | null>(null);
  const [initialBucketOverlay, setInitialBucketOverlay] = useState<BucketOverlayInput | null>(null);

  // Load existing configuration if available
  useEffect(() => {
    const loadConfiguration = async () => {
      if (!planService.contract_line_id || !planService.service_id) return;

      setIsLoading(true);
      try {
        // Fetch contract line to get billing frequency
        const contractLine = await getContractLineById(planService.contract_line_id);
        if (contractLine) {
          setContractLineBillingFrequency(contractLine.billing_frequency);
          setContractLineMode(mapContractLineTypeToMode(contractLine.contract_line_type));
        }

        // Check if configuration exists
        const config = await getConfigurationForService(planService.contract_line_id, planService.service_id);

        if (config) {
          // Load full configuration details
          const configDetails = await getConfigurationWithDetails(config.config_id);
          const details: any = configDetails;

          setBaseConfig({
            ...configDetails.baseConfig,
            quantity: planService.quantity || configDetails.baseConfig.quantity,
            custom_rate: planService.custom_rate !== undefined ? planService.custom_rate : configDetails.baseConfig.custom_rate
          });

          setTypeConfig(configDetails.typeConfig);

          // Set plan fixed config if available
          if (details.planFixedConfig) {
            setPlanFixedConfig(details.planFixedConfig);
          }

          if (configDetails.rateTiers) {
            setRateTiers(configDetails.rateTiers);
          }

          if (details.userTypeRates) {
            setUserTypeRates(details.userTypeRates);
          }
        } else {
          // No configuration exists, use defaults
          const defaultMode = mapContractLineTypeToMode(contractLine?.contract_line_type);
          setBaseConfig({
            contract_line_id: planService.contract_line_id,
            service_id: planService.service_id,
            configuration_type: defaultMode,
            quantity: planService.quantity || 1,
            custom_rate: planService.custom_rate
          });
        }

        // Load bucket overlay if this is an Hourly or Usage service
        if (service && (service.billing_method === 'hourly' || service.billing_method === 'usage')) {
          try {
            const overlay = await getBucketOverlay(planService.contract_line_id, planService.service_id);
            if (overlay) {
              setBucketOverlay(overlay);
              setInitialBucketOverlay(overlay);
            }
          } catch (err) {
            console.error('Error loading bucket overlay:', err);
            // Don't fail the whole form if bucket overlay fails to load
          }
        }
      } catch (error) {
        console.error('Error loading service configuration:', error);
        setError('Failed to load service configuration');
      } finally {
        setIsLoading(false);
      }
    };

    loadConfiguration();
  }, [planService, service]);

  const handleConfigurationChange = (updates: Partial<IContractLineServiceConfiguration>) => {
    setBaseConfig(prev => ({ ...prev, ...updates }));
  };

  const defaultSource = useMemo<'catalog default' | 'contract override' | 'none'>(() => {
    const configuredCustomRate = baseConfig.custom_rate;
    if (configuredCustomRate !== undefined && configuredCustomRate !== null) {
      return 'contract override';
    }

    const catalogDefaultRate = service?.default_rate;
    if (catalogDefaultRate !== undefined && catalogDefaultRate !== null) {
      return 'catalog default';
    }

    return 'none';
  }, [baseConfig.custom_rate, service?.default_rate]);

  const handleTypeConfigChange = (
    type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
    config: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>
  ) => {
    setTypeConfig(config);
  };

  const handlePlanFixedConfigChange = (updates: Partial<IContractLineFixedConfig>) => {
    setPlanFixedConfig(prev => ({ ...prev, ...updates }));
  };

  const handleRateTiersChange = (tiers: IContractLineServiceRateTier[]) => {
    setRateTiers(tiers);
  };

  const handleUserTypeRatesChange = (rates: IUserTypeRate[]) => {
    setUserTypeRates(rates);
  };

  const handleSubmit = async () => {
    if (!planService.contract_line_id || !planService.service_id) {
      setError('Missing plan or service information');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Update the plan service with the new configuration
      await updateContractLineService(
        planService.contract_line_id,
        planService.service_id,
        {
          quantity: baseConfig.quantity,
          customRate: baseConfig.custom_rate,
          typeConfig: typeConfig || undefined
        },
        rateTiers // Pass the rateTiers state here
      );

      // If this is a Fixed configuration, also update the plan fixed config
      if (baseConfig.configuration_type === 'Fixed') {
        await updateContractLineFixedConfig(
          planService.contract_line_id,
          planFixedConfig
        );
      }

      // Handle bucket overlay for Hourly and Usage services
      if (service && (service.billing_method === 'hourly' || service.billing_method === 'usage')) {
        const hadBucketOverlay = initialBucketOverlay !== null;
        const hasBucketOverlay = bucketOverlay !== null;

        if (hasBucketOverlay && bucketOverlay) {
          // Save or update bucket overlay
          await upsertBucketOverlay(
            planService.contract_line_id,
            planService.service_id,
            bucketOverlay,
            baseConfig.quantity,
            baseConfig.custom_rate
          );
        } else if (hadBucketOverlay && !hasBucketOverlay) {
          // Delete bucket overlay if it was removed
          await deleteBucketOverlay(
            planService.contract_line_id,
            planService.service_id
          );
        }
      }

      onServiceUpdated();
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Failed to update service');
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title="Edit Service Configuration"
      className="max-w-4xl"
    >
      <DialogContent>

          {isLoading ? (
            <div className="py-8 text-center">Loading service configuration...</div>
          ) : (
            <ServiceConfigurationPanel
              configuration={{
                ...baseConfig,
                configuration_type: baseConfig.configuration_type || contractLineMode
              }}
              service={service}
              effectiveMode={baseConfig.configuration_type || contractLineMode}
              defaultSource={defaultSource}
              typeConfig={typeConfig}
              planFixedConfig={planFixedConfig}
              rateTiers={rateTiers}
              userTypeRates={userTypeRates}
              onConfigurationChange={handleConfigurationChange}
              onTypeConfigChange={handleTypeConfigChange}
              onPlanFixedConfigChange={handlePlanFixedConfigChange}
              onRateTiersChange={handleRateTiersChange}
              onUserTypeRatesChange={handleUserTypeRatesChange}
              onSave={handleSubmit}
              onCancel={onClose}
              error={error}
              isSubmitting={isSubmitting}
              contractLineBillingFrequency={contractLineBillingFrequency}
              // Pass bucket overlay props
              bucketOverlay={bucketOverlay}
              onBucketOverlayChange={setBucketOverlay}
            />
          )}
      </DialogContent>
    </Dialog>
  );
};

export default ContractLineServiceForm;
