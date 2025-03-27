'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { IPlanService, IService } from 'server/src/interfaces/billing.interfaces';
import { 
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { updatePlanService } from 'server/src/lib/actions/planServiceActions';
import {
  getConfigurationForService,
  getConfigurationWithDetails
} from 'server/src/lib/actions/planServiceConfigurationActions';
import { useTenant } from 'server/src/components/TenantProvider';
import { ServiceConfigurationPanel } from '../service-configurations/ServiceConfigurationPanel';

interface BillingPlanServiceFormProps {
  planService: IPlanService;
  services: IService[];
  serviceCategories: IServiceCategory[]; // Added prop for category lookup
  onClose: () => void;
  onServiceUpdated: () => void;
}

import { IServiceCategory } from 'server/src/interfaces/billing.interfaces'; // Ensure this import exists or add it

const BillingPlanServiceForm: React.FC<BillingPlanServiceFormProps> = ({
  planService,
  services,
  serviceCategories, // Destructure the new prop
  onClose,
  onServiceUpdated
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const tenant = useTenant()!;
  
  const service = services.find(s => s.service_id === planService.service_id);
  
  // State for configuration
  const [baseConfig, setBaseConfig] = useState<Partial<IPlanServiceConfiguration>>({
    plan_id: planService.plan_id,
    service_id: planService.service_id,
    configuration_type: 'Fixed',
    quantity: planService.quantity || 1,
    custom_rate: planService.custom_rate
  });
  
  const [typeConfig, setTypeConfig] = useState<Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig> | null>(null);
  const [rateTiers, setRateTiers] = useState<IPlanServiceRateTier[]>([]);
  const [userTypeRates, setUserTypeRates] = useState<IUserTypeRate[]>([]);

  // Load existing configuration if available
  useEffect(() => {
    const loadConfiguration = async () => {
      if (!planService.plan_id || !planService.service_id) return;
      
      setIsLoading(true);
      try {
        // Check if configuration exists
        const config = await getConfigurationForService(planService.plan_id, planService.service_id);
        
        if (config) {
          // Load full configuration details
          const configDetails = await getConfigurationWithDetails(config.config_id);
          
          setBaseConfig({
            ...configDetails.baseConfig,
            quantity: planService.quantity || configDetails.baseConfig.quantity,
            custom_rate: planService.custom_rate !== undefined ? planService.custom_rate : configDetails.baseConfig.custom_rate
          });
          
          setTypeConfig(configDetails.typeConfig);
          
          if (configDetails.rateTiers) {
            setRateTiers(configDetails.rateTiers);
          }
          
          if (configDetails.userTypeRates) {
            setUserTypeRates(configDetails.userTypeRates);
          }
        } else {
          // No configuration exists, use defaults
          setBaseConfig({
            plan_id: planService.plan_id,
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
            } else if (service.billing_method === 'per_unit') {
              // Check category for per_unit services
              const laborCategories = ['Labor - Support', 'Labor - Project', 'Consulting'];
              // Find the category name using the service_type_id
              const categoryName = serviceCategories.find(cat => cat.category_id === service.service_type_id)?.category_name;
              if (categoryName && laborCategories.includes(categoryName)) {
                configType = 'Hourly'; // Default labor categories to Hourly
              } else {
                configType = 'Usage'; // Default other per_unit categories to Usage
              }
            }
            // Note: 'Bucket' type is not set as a default here, it must be explicitly chosen.

            setBaseConfig(prev => ({
              ...prev,
              configuration_type: configType
            }));
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

  const handleConfigurationChange = (updates: Partial<IPlanServiceConfiguration>) => {
    setBaseConfig(prev => ({ ...prev, ...updates }));
  };

  const handleTypeConfigChange = (
    type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
    config: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>
  ) => {
    setTypeConfig(config);
  };

  const handleRateTiersChange = (tiers: IPlanServiceRateTier[]) => {
    setRateTiers(tiers);
  };

  const handleUserTypeRatesChange = (rates: IUserTypeRate[]) => {
    setUserTypeRates(rates);
  };

  const handleSubmit = async () => {
    if (!planService.plan_id || !planService.service_id) {
      setError('Missing plan or service information');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // Update the plan service with the new configuration
      await updatePlanService(
        planService.plan_id,
        planService.service_id,
        {
          quantity: baseConfig.quantity,
          customRate: baseConfig.custom_rate,
          typeConfig: typeConfig || undefined
        }
      );
      
      onServiceUpdated();
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Failed to update service');
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[800px] max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-4">
            Edit Service Configuration
          </Dialog.Title>
          
          {isLoading ? (
            <div className="py-8 text-center">Loading service configuration...</div>
          ) : (
            <ServiceConfigurationPanel
              configuration={baseConfig}
              service={service}
              typeConfig={typeConfig}
              rateTiers={rateTiers}
              userTypeRates={userTypeRates}
              onConfigurationChange={handleConfigurationChange}
              onTypeConfigChange={handleTypeConfigChange}
              onRateTiersChange={handleRateTiersChange}
              onUserTypeRatesChange={handleUserTypeRatesChange}
              onSave={handleSubmit}
              onCancel={onClose}
              error={error}
              isSubmitting={isSubmitting}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default BillingPlanServiceForm;