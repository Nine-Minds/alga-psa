// server/src/components/billing-dashboard/billing-plans/BucketPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { getPlanServicesWithConfigurations } from 'server/src/lib/actions/planServiceActions';
import GenericPlanServicesList from './GenericPlanServicesList';
import { IService, IBillingPlan } from 'server/src/interfaces/billing.interfaces'; // Added IBillingPlan
import { getBillingPlanById } from 'server/src/lib/actions/billingPlanAction'; // Added action to get base plan details
import {
  IPlanServiceConfiguration,
  IPlanServiceBucketConfig,
  // Removed PlanServiceConfigType import
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import * as RadixAccordion from '@radix-ui/react-accordion';
import { ServiceBucketConfigForm } from './ServiceBucketConfigForm';
import { getConfigurationWithDetails, upsertPlanServiceBucketConfigurationAction } from 'server/src/lib/actions/planServiceConfigurationActions'; // Use upsertPlanServiceBucketConfigurationAction
import { toast } from 'react-hot-toast'; // Use react-hot-toast
// Type for the state holding configurations for all services
type ServiceConfigsState = {
  [serviceId: string]: Partial<IPlanServiceBucketConfig>;
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
type PlanServiceWithDetails = {
  service: IService & { unit_of_measure?: string }; // Ensure unit_of_measure is available
  configuration: IPlanServiceConfiguration; // Base configuration
};

interface BucketPlanConfigurationProps {
  planId: string;
  className?: string;
}

const DEFAULT_BUCKET_CONFIG: Partial<IPlanServiceBucketConfig> = {
  total_minutes: 0,
  overage_rate: undefined, // Use undefined to allow backend default
  allow_rollover: false,
};

export function BucketPlanConfiguration({
  planId,
  className = '',
}: BucketPlanConfigurationProps) {
  const [plan, setPlan] = useState<IBillingPlan | null>(null); // State for base plan details
  const [planServices, setPlanServices] = useState<PlanServiceWithDetails[]>([]);
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
    setPlan(null); // Reset plan on fetch
    try {
      // 0. Fetch base plan details first
      const fetchedPlan = await getBillingPlanById(planId);
      if (!fetchedPlan || fetchedPlan.plan_type !== 'Bucket') {
        setError('Invalid plan type or plan not found.');
        setLoading(false);
        return;
      }
      setPlan(fetchedPlan); // Store base plan details

      // 1. Fetch services associated with the plan
      const fetchedPlanServices = await getPlanServicesWithConfigurations(planId);
      setPlanServices(fetchedPlanServices); // Use all fetched services

      const initialConfigs: ServiceConfigsState = {};
      const currentConfigs: ServiceConfigsState = {};
      const fetchPromises = fetchedPlanServices.map(async (ps: PlanServiceWithDetails) => { // Use fetchedPlanServices and add type
        const serviceId = ps.service.service_id;
        const configId = ps.configuration.config_id; // Corrected property access

        try {
          // Fetch detailed config
          const detailedResult = await getConfigurationWithDetails(configId);
          const bucketConfig = detailedResult?.typeConfig as IPlanServiceBucketConfig | null; // Access typeConfig and cast

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
      console.error('Error fetching plan services or configurations:', err);
      setError('Failed to load service configurations. Please try again.');
      setPlanServices([]);
      setInitialServiceConfigs({});
      setServiceConfigs({});
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchAndInitializeConfigs();
  }, [fetchAndInitializeConfigs]);

  const handleConfigChange = useCallback((serviceId: string, field: keyof IPlanServiceBucketConfig, value: any) => {
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

  const validateConfig = (config: Partial<IPlanServiceBucketConfig>): ServiceValidationErrors['string'] => {
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

    const changedServices: { serviceId: string; configId: string; config: Partial<IPlanServiceBucketConfig> }[] = [];
    const validationPromises: Promise<{ serviceId: string; errors: ServiceValidationErrors['string'] }>[] = [];

    for (const serviceId in serviceConfigs) {
      const planServiceDetail = planServices.find(ps => ps.service.service_id === serviceId);
      if (!planServiceDetail || !planServiceDetail.configuration) continue; // Skip if service details not found

      const configId = planServiceDetail.configuration.config_id;
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

    // Proceed with saving using upsertPlanServiceBucketConfigurationAction
    const savePromises = changedServices.map(({ serviceId, config }) => // Removed configId from destructuring
      upsertPlanServiceBucketConfigurationAction({ // CALL CORRECT ACTION
        planId, // Pass planId
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
        const failedServiceNames = failedSaves.map(f => planServices.find(p => p.service.service_id === f.serviceId)?.service.service_name || f.serviceId).join(', '); // No change needed here, already using serviceId
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
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
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
        <CardHeader>
          <CardTitle>Edit Plan: {plan?.plan_name || '...'} (Bucket) - Service Configurations</CardTitle>
        </CardHeader>
        <CardContent>
          {planServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services are currently configured for this bucket plan.</p>
          ) : (
            <RadixAccordion.Root type="multiple" className="w-full space-y-2">
              {planServices.map(({ service }) => {
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
          {planServices.length > 0 && (
             <div className="mt-6 flex justify-end">
                {/* Added id and data-testid */}
                <Button id="save-all-bucket-configs-button" data-testid="save-all-bucket-configs-button" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save All Configurations
                </Button>
              </div>
          )}
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
        <CardHeader>
          <CardTitle>Services Included in Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <GenericPlanServicesList
            planId={planId}
            onServicesChanged={handleServicesChanged}
            disableEditing={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}