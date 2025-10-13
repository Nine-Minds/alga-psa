// server/src/components/billing-dashboard/contract-lines/BucketContractLineConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { ContractLineDialog } from '../ContractLineDialog';
import Spinner from 'server/src/components/ui/Spinner';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { getContractLineServicesWithConfigurations } from 'server/src/lib/actions/contractLineServiceActions';
import GenericContractLineServicesList from './GenericContractLineServicesList';
import { IService, IContractLine } from 'server/src/interfaces/billing.interfaces'; // Added IContractLine
import { getContractLineById } from 'server/src/lib/actions/contractLineAction'; // Added action to get base contract line details
import {
  IContractLineServiceConfiguration,
  IContractLineServiceBucketConfig,
  // Removed ContractLineServiceConfigType import
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import * as RadixAccordion from '@radix-ui/react-accordion';
import { ServiceBucketConfigForm } from './ServiceBucketConfigForm';
import { getConfigurationWithDetails, upsertContractLineServiceBucketConfigurationAction } from 'server/src/lib/actions/contractLineServiceConfigurationActions'; // Use upsertContractLineServiceBucketConfigurationAction
import { toast } from 'react-hot-toast'; // Use react-hot-toast
// Type for the state holding configurations for all services
type ServiceConfigsState = {
  [serviceId: string]: Partial<IContractLineServiceBucketConfig>;
};

// Type for validation errors
type ServiceValidationErrors = {
  [serviceId: string]: {
    total_minutes?: string;
    overage_rate?: string;
    // Add other fields if needed
  };
};

// Type for the combined service and configuration data used for rendering
type ContractLineServiceWithDetails = {
  service: IService & { unit_of_measure?: string }; // Ensure unit_of_measure is available
  configuration: IContractLineServiceConfiguration; // Base configuration
};

interface BucketContractLineConfigurationProps {
  contractLineId: string;
  className?: string;
}

const DEFAULT_BUCKET_CONFIG: Partial<IContractLineServiceBucketConfig> = {
  total_minutes: 0,
  overage_rate: undefined, // Use undefined to allow backend default
  allow_rollover: false,
};

export function BucketContractLineConfiguration({
  contractLineId,
  className = '',
}: BucketContractLineConfigurationProps) {
  const [contractLine, setContractLine] = useState<IContractLine | null>(null); // State for base contract line details
  const [contractLineServices, setContractLineServices] = useState<ContractLineServiceWithDetails[]>([]);
  const [serviceConfigs, setServiceConfigs] = useState<ServiceConfigsState>({});
  const [initialServiceConfigs, setInitialServiceConfigs] = useState<ServiceConfigsState>({});
  const [serviceValidationErrors, setServiceValidationErrors] = useState<ServiceValidationErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);

  const fetchAndInitializeConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    setContractLine(null); // Reset contract line on fetch
    try {
      // 0. Fetch base contract line details first
      const fetchedContractLine = await getContractLineById(contractLineId);
      if (!fetchedContractLine || fetchedContractLine.contract_line_type !== 'Bucket') {
        setError('Invalid contract line type or contract line not found.');
        setLoading(false);
        return;
      }
      setContractLine(fetchedContractLine); // Store base contract line details

      // 1. Fetch services associated with the contract line
      const fetchedContractLineServices = await getContractLineServicesWithConfigurations(contractLineId);
      setContractLineServices(fetchedContractLineServices); // Use all fetched services

      const initialConfigs: ServiceConfigsState = {};
      const currentConfigs: ServiceConfigsState = {};
      const fetchPromises = fetchedContractLineServices.map(async (ps: ContractLineServiceWithDetails) => { // Use fetchedContractLineServices and add type
        const serviceId = ps.service.service_id;
        const configId = ps.configuration.config_id; // Corrected property access

        try {
          // Fetch detailed config
          const detailedResult = await getConfigurationWithDetails(configId);
          const bucketConfig = detailedResult?.typeConfig as IContractLineServiceBucketConfig | null; // Access typeConfig and cast

          const configData = bucketConfig
            ? {
                // Use nullish coalescing (??) to fall back to default only if bucketConfig value is null or undefined
                total_minutes: bucketConfig.total_minutes ?? DEFAULT_BUCKET_CONFIG.total_minutes,
                overage_rate: bucketConfig.overage_rate ?? DEFAULT_BUCKET_CONFIG.overage_rate, // Will now default to undefined if not set
                allow_rollover: bucketConfig.allow_rollover ?? DEFAULT_BUCKET_CONFIG.allow_rollover,
              }
            : { ...DEFAULT_BUCKET_CONFIG }; // Use defaults if no specific config exists

          initialConfigs[serviceId] = { ...configData };
          currentConfigs[serviceId] = { ...configData };

        } catch (configErr) {
          console.error(`Error fetching config details for service ${serviceId} (configId: ${configId}):`, configErr);
          initialConfigs[serviceId] = { ...DEFAULT_BUCKET_CONFIG };
          currentConfigs[serviceId] = { ...DEFAULT_BUCKET_CONFIG };
        }
      });

      await Promise.all(fetchPromises);

      setInitialServiceConfigs(initialConfigs);
      setServiceConfigs(currentConfigs);
      setServiceValidationErrors({});
      setSaveAttempted(false);

    } catch (err) {
      console.error('Error fetching contract line services or configurations:', err);
      setError('Failed to load service configurations. Please try again.');
      setContractLineServices([]);
      setInitialServiceConfigs({});
      setServiceConfigs({});
    } finally {
      setLoading(false);
    }
  }, [contractLineId]);

  useEffect(() => {
    fetchAndInitializeConfigs();
  }, [fetchAndInitializeConfigs]);

  const handleConfigChange = useCallback((serviceId: string, field: keyof IContractLineServiceBucketConfig, value: any) => {
    setServiceConfigs(prev => ({
      ...prev,
      [serviceId]: {
        ...prev[serviceId],
        [field]: value,
      },
    }));
    setServiceValidationErrors(prev => {
      const updatedErrors = { ...prev };
      if (updatedErrors[serviceId]) {
        delete updatedErrors[serviceId][field as keyof ServiceValidationErrors[string]];
        if (Object.keys(updatedErrors[serviceId]).length === 0) {
          delete updatedErrors[serviceId];
        }
      }
      return updatedErrors;
    });
  }, []);

  const validateConfig = (config: Partial<IContractLineServiceBucketConfig>): ServiceValidationErrors['string'] => {
    const errors: ServiceValidationErrors['string'] = {};
    // Ensure values are treated as numbers, handling null/undefined from state
    const totalMinutes = config.total_minutes === null || config.total_minutes === undefined ? null : Number(config.total_minutes);
    const overageRate = config.overage_rate === null || config.overage_rate === undefined ? null : Number(config.overage_rate);

    if (totalMinutes === null || isNaN(totalMinutes) || totalMinutes < 0) {
      errors.total_minutes = 'Total minutes must be a non-negative number.';
    }
    if (overageRate === null || isNaN(overageRate) || overageRate < 0) {
      errors.overage_rate = 'Overage rate must be a non-negative number.';
    }
    return errors;
  };

  const handleSave = async () => {
    setSaveAttempted(true);
    setSaving(true);
    setError(null);

    const changedServices: { serviceId: string; configId: string; config: Partial<IContractLineServiceBucketConfig> }[] = [];
    const validationPromises: Promise<{ serviceId: string; errors: ServiceValidationErrors['string'] }>[] = [];

    for (const serviceId in serviceConfigs) {
      const contractLineServiceDetail = contractLineServices.find(ps => ps.service.service_id === serviceId);
      if (!contractLineServiceDetail || !contractLineServiceDetail.configuration) continue; // Skip if service details not found

      const configId = contractLineServiceDetail.configuration.config_id;
      const currentConfig = serviceConfigs[serviceId];
      const initialConfig = initialServiceConfigs[serviceId];

      if (JSON.stringify(currentConfig) !== JSON.stringify(initialConfig)) {
        changedServices.push({ serviceId, configId, config: currentConfig });
        validationPromises.push(
          Promise.resolve().then(() => ({
            serviceId,
            errors: validateConfig(currentConfig),
          }))
        );
      }
    }

    if (changedServices.length === 0) {
      toast("No changes detected."); // Use toast() directly for info
      setSaving(false);
      setSaveAttempted(false);
      return;
    }

    const validationResults = await Promise.all(validationPromises);
    const newValidationErrors: ServiceValidationErrors = {};
    let hasErrors = false;

    validationResults.forEach(({ serviceId, errors }) => {
      if (Object.keys(errors).length > 0) {
        newValidationErrors[serviceId] = errors;
        hasErrors = true;
      }
    });

    setServiceValidationErrors(newValidationErrors);

    if (hasErrors) {
      toast.error("Validation errors found. Please correct the highlighted fields.");
      setSaving(false);
      return;
    }

    // Proceed with saving using upsertContractLineServiceBucketConfigurationAction
    const savePromises = changedServices.map(({ serviceId, config }) => // Removed configId from destructuring
      upsertContractLineServiceBucketConfigurationAction({ // CALL CORRECT ACTION
        contractLineId, // Pass contractLineId
        serviceId, // Pass serviceId
        ...config // Spread the bucket config fields
      })
        .catch((err: Error) => { // Added type for err
          console.error(`Error saving config for service ${serviceId}:`, err); // Removed configId from log
          return { error: err, serviceId }; // Removed configId from return
        })
    );

    try {
      const results = await Promise.all(savePromises);
      // Filter results that are error objects
      const failedSaves = results.filter((r): r is { error: Error; serviceId: string } => r !== undefined && r !== null && typeof r === 'object' && 'error' in r); // Removed configId from type guard

      if (failedSaves.length > 0) {
        const failedServiceNames = failedSaves.map(f => contractLineServices.find(p => p.service.service_id === f.serviceId)?.service.service_name || f.serviceId).join(', '); // No change needed here, already using serviceId
        setError(`Failed to save configurations for: ${failedServiceNames}. Please try again.`);
        toast.error(`Failed to save configurations for: ${failedServiceNames}.`);
        await fetchAndInitializeConfigs(); // Refetch to reset state
      } else {
        toast.success("All configurations saved successfully!");
        // Update initial state
        setInitialServiceConfigs(prev => {
            const updatedInitial = {...prev};
            changedServices.forEach(({serviceId, config}) => {
                // Ensure we are saving the validated/processed config if necessary
                updatedInitial[serviceId] = {...config};
            });
            return updatedInitial;
        });
        setSaveAttempted(false);
        setServiceValidationErrors({});
      }
    } catch (err) {
      console.error('Unexpected error during save operation:', err);
      setError('An unexpected error occurred while saving. Please try again.');
      toast.error('An unexpected error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const handleServicesChanged = useCallback(() => {
    fetchAndInitializeConfigs();
  }, [fetchAndInitializeConfigs]);


  if (loading) {
    return <div className="flex justify-center items-center p-8"><Spinner size="sm" /></div>;
  }

  if (error && !loading) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Edit Contract Line: {contractLine?.contract_line_name || '...'} (Bucket) - Service Configurations</CardTitle>
          {contractLine && (
            <ContractLineDialog
              editingContractLine={contractLine}
              onContractLineAdded={() => fetchAndInitializeConfigs()}
              triggerButton={<Button id="edit-contract-line-basics-button" variant="outline" size="sm">Edit Contract Line Basics</Button>}
              allServiceTypes={[]}
            />
          )}
        </CardHeader>
        <CardContent>
          {contractLineServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services are currently configured for this bucket contractLine.</p>
          ) : (
            <RadixAccordion.Root type="multiple" className="w-full space-y-2">
              {contractLineServices.map(({ service }) => {
                const serviceId = service.service_id;
                const config = serviceConfigs[serviceId] || DEFAULT_BUCKET_CONFIG;
                const validationErrors = serviceValidationErrors[serviceId] || {};
                const unitName = service.unit_of_measure || 'Units';

                return (
                  <RadixAccordion.Item key={serviceId} value={serviceId} className="border rounded overflow-hidden odd:bg-slate-100">
                    <RadixAccordion.Header className="flex">
                      <RadixAccordion.Trigger className="flex flex-1 items-center justify-between p-3 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180 bg-muted/20 w-full text-left">
                        <span>{service.service_name} ({unitName})</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                      </RadixAccordion.Trigger>
                    </RadixAccordion.Header>
                    <RadixAccordion.Content className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                      <div className="p-4 border-t">
                        <ServiceBucketConfigForm
                          serviceId={serviceId}
                          config={config} // Prop name is correct
                          unit_of_measure={unitName}
                          validationErrors={validationErrors}
                          saveAttempted={saveAttempted}
                          disabled={saving}
                          onConfigChange={handleConfigChange}
                        />
                      </div>
                    </RadixAccordion.Content>
                  </RadixAccordion.Item>
                );
              })}
            </RadixAccordion.Root>
          )}
          {contractLineServices.length > 0 && (
             <div className="mt-6 flex justify-end">
                {/* Added id and data-testid */}
                <Button id="save-all-bucket-configs-button" data-testid="save-all-bucket-configs-button" onClick={handleSave} disabled={saving}>
                  {saving ? <LoadingIndicator spinnerProps={{ size: "xs" }} text="Save All Configurations" /> : "Save All Configurations"}
                </Button>
              </div>
          )}
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
        <CardHeader>
          <CardTitle>Services Included in Contract Line</CardTitle>
        </CardHeader>
        <CardContent>
          <GenericContractLineServicesList
            contractLineId={contractLineId}
            onServicesChanged={handleServicesChanged}
            disableEditing={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}