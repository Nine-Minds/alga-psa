// server/src/components/billing-dashboard/FixedPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { getServices } from 'server/src/lib/actions/serviceActions';
import {
  getBillingPlanById,
  updateFixedPlanConfiguration,
  getFixedPlanConfiguration
} from 'server/src/lib/actions/billingPlanAction';
import { getPlanServices } from 'server/src/lib/actions/planServiceActions';
import { IService, IBillingPlan, IPlanService } from 'server/src/interfaces/billing.interfaces';
import FixedPlanServicesList from '../FixedPlanServicesList'; // Import the actual component

interface FixedPlanConfigurationProps {
  planId: string;
  className?: string;
}

export function FixedPlanConfiguration({
  planId,
  className = '',
}: FixedPlanConfigurationProps) {
  const [plan, setPlan] = useState<IBillingPlan | null>(null);
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>('start');
  const [serviceCatalogId, setServiceCatalogId] = useState<string | undefined>(undefined); // Assuming fixed plans link to one service directly for the base rate

  const [services, setServices] = useState<IService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    baseRate?: string;
    serviceCatalogId?: string;
  }>({});

  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch the basic plan data
      const fetchedPlan = await getBillingPlanById(planId);
      if (fetchedPlan && fetchedPlan.plan_type === 'Fixed') {
        setPlan(fetchedPlan);
        
        // Fetch associated services
        const associatedServices: IPlanService[] = await getPlanServices(planId);
        
        // If we have associated services, get the fixed plan configuration
        if (associatedServices.length > 0) {
          const serviceId = associatedServices[0].service_id;
          setServiceCatalogId(serviceId);
          
          // Fetch the fixed plan configuration for this service
          const fixedConfig = await getFixedPlanConfiguration(planId, serviceId);
          
          if (fixedConfig) {
            // Set the configuration values
            setBaseRate(fixedConfig.base_rate ?? undefined);
            setEnableProration(fixedConfig.enable_proration);
            setBillingCycleAlignment(fixedConfig.billing_cycle_alignment);
          } else {
            // No configuration exists yet, use defaults
            setBaseRate(undefined);
            setEnableProration(false);
            setBillingCycleAlignment('start');
          }
        } else {
          setServiceCatalogId(undefined); // No service associated
          // Having no services initially is a valid state, not an error
        }
      } else {
        setError('Invalid plan type or plan not found.');
      }
    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError('Failed to load plan configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  const fetchServices = useCallback(async () => {
    // Only fetch services if needed (e.g., if service selection is part of this config)
    if (!serviceCatalogId) { // Or based on some other condition
        setLoading(true); // Consider separate loading state for services
        try {
            const fetchedServices = await getServices();
            setServices(fetchedServices);
        } catch (err) {
            console.error('Error fetching services:', err);
            setError(prev => prev ? `${prev}\nFailed to load services.` : 'Failed to load services.');
        } finally {
            setLoading(false); // Adjust loading state management
        }
    }
  }, [serviceCatalogId]); // Dependency might change based on logic

  useEffect(() => {
    fetchPlanData();
    fetchServices(); // Fetch services initially
  }, [fetchPlanData, fetchServices]);

  // Validate inputs
  useEffect(() => {
    const errors: { baseRate?: string; serviceCatalogId?: string } = {};
    if (baseRate === undefined || baseRate === null) {
      errors.baseRate = 'Base rate is required';
    } else if (baseRate < 0) {
      errors.baseRate = 'Base rate cannot be negative';
    }
    // Add validation for serviceCatalogId if it's mandatory and editable here
    // if (!serviceCatalogId) {
    //   errors.serviceCatalogId = 'Please select a service';
    // }
    setValidationErrors(errors);
  }, [baseRate, serviceCatalogId]);

  const handleBaseRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    setBaseRate(value);
  };

  const handleSave = async () => {
    // Prioritize checking for a selected service
    if (!serviceCatalogId) {
        setSaveError("Please select a primary service for the base rate before saving.");
        return;
    }
    // Check for other validation errors or if the plan hasn't loaded
    if (!plan || Object.keys(validationErrors).length > 0) {
        setSaveError("Cannot save due to validation errors or plan not being loaded.");
        return;
    }
    setSaving(true);
    setSaveError(null);
    try {
        // Use the new updateFixedPlanConfiguration function to update the fixed plan configuration
        // This function handles updating the configuration in the plan_service_fixed_config table
        await updateFixedPlanConfiguration(
            planId,
            serviceCatalogId,
            {
                base_rate: baseRate,
                enable_proration: enableProration,
                billing_cycle_alignment: enableProration ? billingCycleAlignment as 'start' | 'end' | 'prorated' : 'start',
            }
        );

        // Optionally re-fetch data to confirm changes
        await fetchPlanData();

        // Show success feedback
        console.log('Fixed plan configuration updated successfully');

    } catch (err) {
        console.error('Error saving plan configuration:', err);
        setSaveError('Failed to save configuration. Please try again.');
    } finally {
        setSaving(false);
    }
  };


  const alignmentOptions = [
    { value: 'start', label: 'Start of Billing Cycle' },
    { value: 'end', label: 'End of Billing Cycle' },
    { value: 'calendar', label: 'Calendar Month' },
    { value: 'anniversary', label: 'Anniversary Date' }
  ];

  const alignmentDescriptions: Record<string, string> = {
    start: 'Proration is calculated based on the start date of the billing cycle.',
    end: 'Proration is calculated based on the end date of the billing cycle.',
    calendar: 'Proration aligns to the calendar month (e.g., the 1st of the month).',
    anniversary: 'Proration aligns to the anniversary date of the subscription or plan start.'
  };

  // Service options might only be needed if the service is selectable/changeable here.
  const serviceOptions = services.map(service => ({
    value: service.service_id,
    label: service.service_name
  }));

  if (loading && !plan) {
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

  if (!plan) {
      return <div className="p-4">Plan not found or invalid type.</div>; // Should not happen if error handling is correct
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Fixed Plan Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Validation Error Alert */}
          {Object.keys(validationErrors).length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please fix the following errors:
                <ul className="list-disc pl-5 mt-1">
                  {Object.values(validationErrors).map((errorMsg, index) => (
                    <li key={index}>{errorMsg}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="fixed-plan-base-rate">Base Rate</Label>
              <Input
                id="fixed-plan-base-rate"
                type="number"
                value={baseRate?.toString() || ''}
                onChange={handleBaseRateChange}
                placeholder="Enter base rate"
                disabled={saving}
                min={0}
                step={0.01}
                // className={validationErrors.baseRate ? 'border-red-500' : ''} // Removed inline error style
              />
              {/* Removed inline error display */}
              <p className="text-sm text-muted-foreground mt-1">
                The base rate for this fixed plan.
              </p>
            </div>

            {/* Service Selection - Keep only if the primary service is changeable here */}
            {/* This might be handled in the Services List instead */}
            {/* <div>
              <Label htmlFor="fixed-plan-service">Primary Service</Label>
              <CustomSelect
                id="fixed-plan-service"
                options={serviceOptions}
                onValueChange={setServiceCatalogId} // Adjust state update logic
                value={serviceCatalogId}
                placeholder={loading ? "Loading services..." : "Select a service"}
                className="w-full"
                disabled={saving || loading || services.length === 0}
              />
              {validationErrors.serviceCatalogId ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.serviceCatalogId}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  The primary service associated with the base rate.
                </p>
              )}
            </div> */}
          </div>

          <div className="space-y-4 pt-4">
             <div className="flex items-center space-x-2">
                <Switch
                    id="fixed-plan-enable-proration"
                    checked={enableProration}
                    onCheckedChange={setEnableProration}
                    disabled={saving}
                />
                <Label htmlFor="fixed-plan-enable-proration" className="cursor-pointer">
                    Enable Proration
                </Label>
             </div>

             {enableProration && (
                <div className="pl-8 space-y-2">
                  <Label htmlFor="fixed-plan-billing-cycle-alignment">Billing Cycle Alignment</Label>
                  <CustomSelect
                    id="fixed-plan-billing-cycle-alignment"
                    options={alignmentOptions}
                    onValueChange={setBillingCycleAlignment}
                    value={billingCycleAlignment}
                    placeholder="Select alignment"
                    className="w-full md:w-1/2"
                    disabled={saving}
                  />
                  <p className="text-sm text-muted-foreground">
                    {alignmentDescriptions[billingCycleAlignment]}
                  </p>
                </div>
             )}
          </div>

          <div className="flex justify-end pt-4">
            <Button id="save-fixed-config-button" onClick={handleSave} disabled={saving || Object.keys(validationErrors).length > 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Associated Services</CardTitle>
          </CardHeader>
          <CardContent>
              <FixedPlanServicesList planId={planId} />
          </CardContent>
      </Card>
    </div>
  );
}