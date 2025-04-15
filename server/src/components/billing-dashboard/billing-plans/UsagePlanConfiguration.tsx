// server/src/components/billing-dashboard/billing-plans/UsagePlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import * as Accordion from '@radix-ui/react-accordion'; // Import Radix Accordion
import { ChevronDownIcon } from '@radix-ui/react-icons'; // Icon for Accordion

// Import actions and types
import { getPlanServicesWithConfigurations } from 'server/src/lib/actions/planServiceActions'; // Get list of services
import { getPlanServiceConfiguration } from 'server/src/lib/actions/planServiceConfigurationActions'; // Get config per service
// Import specific interfaces needed
import { IPlanServiceConfiguration, IPlanServiceUsageConfig, IPlanServiceRateTier, IService, IBillingPlan } from 'server/src/interfaces'; // Added IBillingPlan
import { getBillingPlanById } from 'server/src/lib/actions/billingPlanAction'; // Added action to get base plan details
import { upsertPlanServiceConfiguration } from 'server/src/lib/actions/planServiceConfigurationActions'; // Import the upsert action
import { ServiceUsageConfigForm, ServiceUsageConfig, ServiceValidationErrors } from './ServiceUsageConfigForm'; // Import the new form component and types
import { TierConfig } from './ServiceTierEditor'; // Import TierConfig type

// Keep GenericPlanServicesList for now, might remove in Phase 3
import GenericPlanServicesList from './GenericPlanServicesList';
interface UsagePlanConfigurationProps {
  planId: string;
  className?: string;
}

// Define the structure returned by getPlanServicesWithConfigurations locally
// Based on its usage in GenericPlanServicesList.tsx and the action definition
type PlanServiceWithConfig = {
  service: IService & { service_type_name?: string };
  configuration: IPlanServiceConfiguration;
  // typeConfig might also be present, but we primarily need service_id and service_name
};


// State structure for all service configurations
type AllServiceConfigs = {
  [serviceId: string]: ServiceUsageConfig;
};

// State structure for all service validation errors
type AllServiceValidationErrors = {
  [serviceId: string]: ServiceValidationErrors;
};

// Define the expected result type for getPlanServiceConfiguration
// Combining relevant fields from the interfaces file
type FetchedServiceConfig = IPlanServiceConfiguration & IPlanServiceUsageConfig & {
    tiers?: IPlanServiceRateTier[];
};

export function UsagePlanConfiguration({
  planId,
  className = '',
}: UsagePlanConfigurationProps) {
  // State for the base plan details
  const [plan, setPlan] = useState<IBillingPlan | null>(null);
  // State for the list of services associated with the plan
  const [planServices, setPlanServices] = useState<PlanServiceWithConfig[]>([]);
  // State to hold configuration for each service, keyed by serviceId (current state)
  const [serviceConfigs, setServiceConfigs] = useState<AllServiceConfigs>({});
  // State to hold the initial configuration fetched from the server
  const [initialServiceConfigs, setInitialServiceConfigs] = useState<AllServiceConfigs>({});
  // State to hold validation errors for each service, keyed by serviceId
  const [serviceValidationErrors, setServiceValidationErrors] = useState<AllServiceValidationErrors>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAttempted, setSaveAttempted] = useState<boolean>(false);

  // --- Data Fetching ---
  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlan(null); // Reset plan on fetch
    setServiceConfigs({}); // Reset current configs on fetch
    setInitialServiceConfigs({}); // Reset initial configs on fetch
    setPlanServices([]); // Reset services on fetch
    try {
      // 0. Fetch base plan details first
      const fetchedPlan = await getBillingPlanById(planId);
      if (!fetchedPlan || fetchedPlan.plan_type !== 'Usage') {
        setError('Invalid plan type or plan not found.');
        setLoading(false);
        return;
      }
      setPlan(fetchedPlan); // Store base plan details

      // 1. Fetch the list of services associated with the plan
      const servicesList = await getPlanServicesWithConfigurations(planId);
      setPlanServices(servicesList);

      if (servicesList.length === 0) {
        // Don't return early, we still want to show the empty state with the correct title
      }

      // 2. Fetch configuration for each service concurrently
      const configPromises = servicesList.map(service =>
        // Use service.configuration.service_id as it's guaranteed by PlanServiceWithConfig type
        getPlanServiceConfiguration(planId, service.configuration.service_id)
          .then(config => ({ serviceId: service.configuration.service_id, config: config as FetchedServiceConfig | null })) // Cast result
          .catch(err => {
            console.error(`Error fetching config for service ${service.configuration.service_id}:`, err);
            // Return null config on error for this specific service
            return { serviceId: service.configuration.service_id, config: null };
          })
      );

      const results = await Promise.all(configPromises);

      // 3. Populate the serviceConfigs state
      const initialConfigs: AllServiceConfigs = {};
      results.forEach(({ serviceId, config }) => {
        if (config) {
          // Ensure tiers have client-side IDs
          // Map backend tier structure to frontend TierConfig
          const tiersWithIds = (config.tiers || []).map((tier, index) => ({
            id: `tier-${serviceId}-${index}-${Date.now()}`, // Generate unique ID
            fromAmount: tier.min_quantity, // Map min_quantity
            toAmount: tier.max_quantity === undefined || tier.max_quantity === null ? null : tier.max_quantity, // Map max_quantity (handle undefined/null)
            rate: tier.rate,
          }));
          initialConfigs[serviceId] = {
            // Handle potential null values from DB by converting to undefined for state
            base_rate: config.base_rate === null ? undefined : Number(config.base_rate),
            unit_of_measure: config.unit_of_measure,
            enable_tiered_pricing: config.enable_tiered_pricing,
            minimum_usage: config.minimum_usage === null ? undefined : config.minimum_usage,
            tiers: tiersWithIds, // Use mapped tiers
          };
        } else {
          // Handle case where config fetch failed or service has no config yet
          // Initialize with default/empty values
          initialConfigs[serviceId] = {
             // Access nested service properties correctly
             base_rate: Number(servicesList.find(s => s.configuration.service_id === serviceId)?.service?.default_rate) || undefined,
             unit_of_measure: servicesList.find(s => s.configuration.service_id === serviceId)?.service?.unit_of_measure || '',
             enable_tiered_pricing: false,
             minimum_usage: 0,
             tiers: [],
          };
          console.warn(`Using default config for service ${serviceId}`);
        }
      });
      setServiceConfigs(initialConfigs);
      setInitialServiceConfigs(JSON.parse(JSON.stringify(initialConfigs))); // Deep copy for initial state

    } catch (err) {
      console.error('Error fetching plan services or configurations:', err);
      setError('Failed to load plan services or configurations. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // --- Event Handlers ---
  const handleConfigChange = useCallback((serviceId: string, field: keyof ServiceUsageConfig, value: any) => {
    setServiceConfigs(prevConfigs => ({
      ...prevConfigs,
      [serviceId]: {
        ...prevConfigs[serviceId],
        [field]: value,
      }
    }));
    // Clear validation error for the specific field when changed
    setServiceValidationErrors(prevErrors => ({
        ...prevErrors,
        [serviceId]: {
            ...prevErrors[serviceId],
            [field]: undefined, // Clear error for this field
            ...(field === 'enable_tiered_pricing' && { tiers: undefined }) // Clear tier error if switch toggled
        }
    }));
    setSaveAttempted(false); // Reset save attempt state on change
    setSaveError(null); // Clear global save error
  }, []);

  const handleTiersChange = useCallback((serviceId: string, tiers: TierConfig[]) => {
    setServiceConfigs(prevConfigs => ({
      ...prevConfigs,
      [serviceId]: {
        ...prevConfigs[serviceId],
        tiers: tiers,
      }
    }));
     // Clear validation error for tiers when changed
    setServiceValidationErrors(prevErrors => ({
        ...prevErrors,
        [serviceId]: {
            ...prevErrors[serviceId],
            tiers: undefined,
        }
    }));
    setSaveAttempted(false); // Reset save attempt state on change
    setSaveError(null); // Clear global save error
  }, []);

  // Callback to refresh data when services are added/removed in the child component
  const handleServicesChanged = useCallback(() => {
    console.log('Services changed, refetching plan data...');
    fetchPlanData();
  }, [fetchPlanData]);

  // --- Validation ---
  const validateSingleServiceConfig = (config: ServiceUsageConfig): ServiceValidationErrors => {
    const errors: ServiceValidationErrors = {};
    const isTiered = config.enable_tiered_pricing ?? false;

    if (!isTiered && (config.base_rate === undefined || config.base_rate === null)) {
        errors.base_rate = 'Base rate is required when tiered pricing is off.';
    } else if (config.base_rate !== undefined && config.base_rate < 0) {
        errors.base_rate = 'Base rate cannot be negative.';
    }

    if (config.minimum_usage !== undefined && config.minimum_usage < 0) {
        errors.minimum_usage = 'Minimum usage cannot be negative.';
    }
    if (!config.unit_of_measure) {
        errors.unit_of_measure = 'Unit of measure is required.';
    }

    if (isTiered) {
        const tiers = config.tiers || [];
        if (tiers.length === 0) {
            errors.tiers = 'At least one tier is required when tiered pricing is enabled.';
        } else {
            const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
            let tierErrorFound = false;
            for (let i = 0; i < sortedTiers.length; i++) {
                const currentTier = sortedTiers[i];
                if (currentTier.rate < 0) {
                    errors.tiers = 'Tier rates cannot be negative.';
                    tierErrorFound = true; break;
                }
                if (currentTier.toAmount !== null && currentTier.toAmount < currentTier.fromAmount) {
                    errors.tiers = `Tier ${i + 1}: Upper bound must be >= lower bound.`;
                    tierErrorFound = true; break;
                }
                if (i < sortedTiers.length - 1) {
                    const nextTier = sortedTiers[i + 1];
                    if (currentTier.toAmount === null) {
                        errors.tiers = 'Only the last tier can have an unlimited upper bound.';
                        tierErrorFound = true; break;
                    }
                    // Allow adjacent: toAmount can equal next fromAmount
                    // Allow adjacent tiers: upper bound can equal next lower bound
                    if (currentTier.toAmount !== null && currentTier.toAmount > nextTier.fromAmount) {
                         errors.tiers = `Tier ${i + 1} overlaps with Tier ${i + 2}.`;
                         tierErrorFound = true; break;
                    }
                    // Check for gaps
                    // Check for gaps (ensure toAmount is not null before adding 1)
                    if (currentTier.toAmount !== null && currentTier.toAmount + 1 < nextTier.fromAmount) {
                         errors.tiers = `Gap detected between Tier ${i + 1} and Tier ${i + 2}.`;
                         tierErrorFound = true; break;
                    }
                }
            }
            if (!tierErrorFound && sortedTiers[0]?.fromAmount !== 0) {
                errors.tiers = 'The first tier must start from 0.';
            }
        }
    }
    return errors;
  };

  const validateAllServiceConfigs = (): AllServiceValidationErrors => {
    const allErrors: AllServiceValidationErrors = {};
    let hasErrors = false;
    for (const serviceId in serviceConfigs) {
      const config = serviceConfigs[serviceId];
      const serviceErrors = validateSingleServiceConfig(config);
      if (Object.keys(serviceErrors).length > 0) {
        allErrors[serviceId] = serviceErrors;
        hasErrors = true;
      }
    }
    return allErrors;
  };


  // --- Save Logic (Phase 3: Save Changed Configurations) ---
  const handleSave = async () => {
    setSaveAttempted(true);
    setSaveError(null);
    setServiceValidationErrors({}); // Clear previous errors

    // 1. Identify changed services
    const changedServiceIds = Object.keys(serviceConfigs).filter(serviceId => {
      // Simple deep comparison using JSON stringify (consider lodash.isEqual for robustness)
      return JSON.stringify(serviceConfigs[serviceId]) !== JSON.stringify(initialServiceConfigs[serviceId]);
    });

    if (changedServiceIds.length === 0) {
      setSaveError("No changes detected to save.");
      setSaveAttempted(false); // No actual save attempt needed
      return;
    }

    // 2. Validate *only* changed services
    const validationErrorsForChanged: AllServiceValidationErrors = {};
    let hasErrors = false;
    for (const serviceId of changedServiceIds) {
      const config = serviceConfigs[serviceId];
      const serviceErrors = validateSingleServiceConfig(config);
      if (Object.keys(serviceErrors).length > 0) {
        validationErrorsForChanged[serviceId] = serviceErrors;
        hasErrors = true;
      }
    }

    // 3. Handle validation errors
    if (hasErrors) {
      setServiceValidationErrors(validationErrorsForChanged);
      setSaveError("Cannot save, validation errors exist in the modified services.");
      // TODO: Consider focusing/opening the first accordion item with an error
      console.log("Validation failed for changed services:", Object.keys(validationErrorsForChanged));
      return;
    }

    // 4. Prepare payloads and execute upserts
    setSaving(true);
    try {
      const savePromises = changedServiceIds.map(serviceId => {
        const config = serviceConfigs[serviceId];

        // Prepare backend tier structure
        const tiersToSave = (config.tiers || [])
          .sort((a, b) => a.fromAmount - b.fromAmount)
          .map(tier => ({
            min_quantity: tier.fromAmount,
            // Map null back to undefined for the backend if necessary, or handle null in backend
            max_quantity: tier.toAmount === null ? undefined : tier.toAmount,
            rate: tier.rate,
          }));

        const payload = {
          planId: planId,
          serviceId: serviceId,
          // tenantId is handled by the backend action
          base_rate: config.enable_tiered_pricing ? undefined : config.base_rate,
          unit_of_measure: config.unit_of_measure,
          minimum_usage: config.minimum_usage,
          enable_tiered_pricing: config.enable_tiered_pricing,
          tiers: config.enable_tiered_pricing ? tiersToSave : [],
        };

        console.log(`Saving config for service ${serviceId}:`, payload);
        return upsertPlanServiceConfiguration(payload);
      });

      // Execute all save operations concurrently
      await Promise.all(savePromises);

      // 5. Handle success
      console.log("Successfully saved configurations for services:", changedServiceIds);
      // Update initial state to reflect the saved state
      setInitialServiceConfigs(JSON.parse(JSON.stringify(serviceConfigs)));
      setSaveAttempted(false); // Reset save attempt on success
      setSaveError(null); // Clear any previous save error
      // Optionally: Show a success toast/message

    } catch (err: any) {
      // 6. Handle errors
      console.error('Error saving service configurations:', err);
      // Attempt to parse Zod validation errors if available
      let errorMessage = 'Failed to save one or more service configurations. Please check the details and try again.';
      if (err.issues && Array.isArray(err.issues)) {
          errorMessage = `Validation Error: ${err.issues.map((issue: any) => `${issue.path.join('.')} - ${issue.message}`).join(', ')}`;
      } else if (err.message) {
          errorMessage = `Error: ${err.message}`;
      }
      setSaveError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // --- Rendering ---
  if (loading) {
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (planServices.length === 0) {
      return (
          <div className={`space-y-6 ${className}`}>
              <Card>
                  <CardHeader>
                      <CardTitle>Edit Plan: {plan?.plan_name || '...'} (Usage)</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-muted-foreground mb-4">No services are currently associated with this usage plan. Add services below to configure their pricing.</p>
                      {/* Keep the GenericPlanServicesList to allow adding services */}
                      <GenericPlanServicesList planId={planId} onServicesChanged={handleServicesChanged} />
                  </CardContent>
              </Card>
          </div>
      );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Edit Plan: {plan?.plan_name || '...'} (Usage) - Service Pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <Accordion.Root
            type="multiple" // Allow multiple items open
            className="w-full space-y-2"
            // Consider managing open state if needed to auto-open on error
          >
            {planServices.sort((a, b) => (a.service?.service_name || '').localeCompare(b.service?.service_name || '')).map((service, index) => ( // Add index
              // Use slate-100 for a subtle alternating background
              <Accordion.Item key={service.configuration.service_id} value={service.configuration.service_id} className="border rounded overflow-hidden odd:bg-slate-100">
                <Accordion.Header className="flex">
                  <Accordion.Trigger
                    id={`accordion-trigger-${service.configuration.service_id}`}
                    className="flex flex-1 items-center justify-between p-3 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180 bg-muted/20"
                  >
                    <div className="flex flex-col text-left"> {/* Use flex-col for name and summary */}
                      <span>{service.service?.service_name || `Service ID: ${service.configuration.service_id}`}</span>
                      {/* Add Summary Span */}
                      <span className="text-xs font-normal text-muted-foreground">
                        {(() => {
                          const config = serviceConfigs[service.configuration.service_id];
                          if (!config) return 'Loading...';
                          if (config.enable_tiered_pricing) {
                            return `Tiered Pricing (${config.tiers?.length || 0} tiers)`;
                          } else {
                            const rate = config.base_rate !== undefined ? `$${config.base_rate.toFixed(2)}` : 'Not Set';
                            const unit = config.unit_of_measure || 'Unit';
                            return `${rate} / ${unit}`;
                          }
                        })()}
                      </span>
                    </div>
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content
                  id={`accordion-content-${service.configuration.service_id}`}
                  className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
                >
                  <div className="p-4 border-t">
                    {serviceConfigs[service.configuration.service_id] ? (
                      <ServiceUsageConfigForm
                        serviceId={service.configuration.service_id}
                        serviceName={service.service?.service_name || ''}
                        config={serviceConfigs[service.configuration.service_id]}
                        validationErrors={serviceValidationErrors[service.configuration.service_id]}
                        saveAttempted={saveAttempted}
                        disabled={saving} // Disable form while saving
                        onConfigChange={handleConfigChange}
                        onTiersChange={handleTiersChange}
                      />
                    ) : (
                      <div className="text-muted-foreground">Loading configuration...</div>
                    )}
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button id="save-all-service-configs-button" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save All Configurations
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Keep Services List for adding/removing services */}
       <Card>
           <CardHeader>
               <CardTitle>Manage Plan Services</CardTitle>
           </CardHeader>
           <CardContent>
               <GenericPlanServicesList planId={planId} onServicesChanged={handleServicesChanged} disableEditing={true} />
           </CardContent>
       </Card>
    </div>
  );
}