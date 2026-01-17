'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { IContractLineService, IService, IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces';
import { updateContractLineFixedConfig, getContractLineById } from '@alga-psa/billing/actions/contractLineAction';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { updateContractLineService } from '@alga-psa/billing/actions/contractLineServiceActions';
import {
  getConfigurationForService,
  getConfigurationWithDetails
} from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';
import { useTenant } from 'server/src/components/TenantProvider';
import { ServiceConfigurationPanel } from '../service-configurations/ServiceConfigurationPanel';
import {
  BucketOverlayInput,
  getBucketOverlay,
  upsertBucketOverlay,
  deleteBucketOverlay
} from 'server/src/lib/actions/bucketOverlayActions';

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
  const tenant = useTenant()!;

  const service = services.find(s => s.service_id === planService.service_id);

  // Helper function to derive config type from service properties
  const getDerivedConfigType = (svc: IService | undefined): 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' | undefined => {
    if (!svc) return undefined;

    if (svc.billing_method === 'fixed') {
      return 'Fixed';
    } else if (svc.billing_method === 'hourly') {
      return 'Hourly';
    } else if (svc.billing_method === 'usage') {
      return 'Usage';
    }
    // Add logic for 'Bucket' if applicable based on service properties
    return undefined; // Default if no match
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
          setBaseConfig({
            contract_line_id: planService.contract_line_id,
            service_id: planService.service_id,
            configuration_type: 'Fixed',
            quantity: planService.quantity || 1,
            custom_rate: planService.custom_rate
          });

          // Set default type config based on service billing_method and category (service_type)
          if (service) {
            let configType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' = 'Fixed'; // Default to Fixed

            if (service.billing_method === 'fixed') {
              configType = 'Fixed';
            } else if (service.billing_method === 'hourly') {
              configType = 'Hourly';
            } else if (service.billing_method === 'usage') {
              configType = 'Usage';
            }
            // Note: 'Bucket' type is not set as a default here, it must be explicitly chosen.

            setBaseConfig(prev => ({
              ...prev,
              configuration_type: configType
            }));
          }
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
              // Pass a configuration object with the DERIVED type
              configuration={{
                ...baseConfig,
                configuration_type: getDerivedConfigType(service) || baseConfig.configuration_type // Fallback to original if derivation fails
              }}
              service={service}
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
