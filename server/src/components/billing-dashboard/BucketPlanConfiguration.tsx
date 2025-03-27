// server/src/components/billing-dashboard/BucketPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { getServices } from 'server/src/lib/actions/serviceActions'; // Assuming this action exists
import { getBillingPlanById, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction'; // Corrected path
import { getPlanServices } from 'server/src/lib/actions/planServiceActions'; // Assuming this action exists
import GenericPlanServicesList from './GenericPlanServicesList'; // Import the generic list
import { IService, IBillingPlan, IPlanService } from 'server/src/interfaces/billing.interfaces'; // Added IPlanService

// Define the expected shape of the plan object returned by getBillingPlanById for Bucket
type BucketPlanData = IBillingPlan & {
    total_hours?: number;
    overage_rate?: number;
    allow_rollover?: boolean;
    // service_catalog_id might be derived from associated services
};

interface BucketPlanConfigurationProps {
  planId: string;
  className?: string;
}

export function BucketPlanConfiguration({
  planId,
  className = '',
}: BucketPlanConfigurationProps) {
  const [plan, setPlan] = useState<BucketPlanData | null>(null);
  const [totalHours, setTotalHours] = useState<number | undefined>(undefined);
  const [billingPeriod, setBillingPeriod] = useState<string>(''); // Should match plan's billing_frequency
  const [overageRate, setOverageRate] = useState<number | undefined>(undefined);
  const [serviceCatalogId, setServiceCatalogId] = useState<string | undefined>(undefined); // Assuming one primary service for the bucket
  const [allowRollover, setAllowRollover] = useState<boolean>(false);

  const [services, setServices] = useState<IService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    totalHours?: string;
    billingPeriod?: string; // Usually inherited from plan, but might be configurable?
    overageRate?: string;
    serviceCatalogId?: string;
  }>({});

  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedPlan = await getBillingPlanById(planId) as BucketPlanData; // Cast to expected type
      if (fetchedPlan && fetchedPlan.plan_type === 'Bucket') { // Match enum case
        setPlan(fetchedPlan);
        // Assume config fields are returned directly on the plan object
        setTotalHours(fetchedPlan.total_hours);
        setBillingPeriod(fetchedPlan.billing_frequency); // Use plan's frequency
        setOverageRate(fetchedPlan.overage_rate);
        setAllowRollover(fetchedPlan.allow_rollover ?? false);

        // Fetch associated services separately
        const associatedServices: IPlanService[] = await getPlanServices(planId);
        // Assuming the first service is the relevant one for a bucket plan's config
        if (associatedServices.length > 0) {
            setServiceCatalogId(associatedServices[0].service_id);
        } else {
            setServiceCatalogId(undefined); // No service associated
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

  // Fetch services if needed for selection
  const fetchServices = useCallback(async () => {
     // Only fetch if service selection is part of this config
     // setLoading(true); // Consider separate loading state
     try {
         const fetchedServices = await getServices();
         setServices(fetchedServices);
     } catch (err) {
         console.error('Error fetching services:', err);
         setError(prev => prev ? `${prev}\nFailed to load services.` : 'Failed to load services.');
     } finally {
        // setLoading(false);
     }
  }, []);


  useEffect(() => {
    fetchPlanData();
    fetchServices(); // Fetch services initially
  }, [fetchPlanData, fetchServices]);

  // Validate inputs
  useEffect(() => {
    const errors: typeof validationErrors = {};
    if (totalHours === undefined || totalHours <= 0) errors.totalHours = 'Total hours must be greater than zero';
    if (overageRate === undefined || overageRate < 0) errors.overageRate = 'Overage rate cannot be negative';
    if (!billingPeriod) errors.billingPeriod = 'Billing period is required'; // Should be set from plan
    // Add serviceCatalogId validation if it's mandatory and selectable here
    // if (!serviceCatalogId) errors.serviceCatalogId = 'Please select a service';
    setValidationErrors(errors);
  }, [totalHours, overageRate, billingPeriod, serviceCatalogId]);

  const handleSave = async () => {
    if (!plan || Object.values(validationErrors).some(e => e)) {
        setSaveError("Cannot save, validation errors exist or plan not loaded.");
        return;
    }
    setSaving(true);
    setSaveError(null);
    try {
        // Construct payload with correct field names expected by updateBillingPlan
        const updatePayload: Partial<BucketPlanData> = {
            total_hours: totalHours,
            // billing_period: billingPeriod, // Usually not part of config, but plan itself
            overage_rate: overageRate,
            allow_rollover: allowRollover,
            // Service association updates likely handled separately
        };
        // Update plan config. Service association might need separate handling.
        await updateBillingPlan(planId, updatePayload as Partial<IBillingPlan>); // Cast payload
        // Optionally re-fetch or show success
    } catch (err) {
        console.error('Error saving plan configuration:', err);
        setSaveError('Failed to save configuration. Please try again.');
    } finally {
        setSaving(false);
    }
  };

  // Simplified number input handler
  const handleNumberInputChange = (setter: React.Dispatch<React.SetStateAction<number | undefined>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value === '' ? undefined : Number(e.target.value);
       if (!isNaN(value as number) && (value as number) >= 0) {
           setter(value);
       } else if (e.target.value === '') {
            setter(undefined); // Allow clearing the input
       }
  };

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
      return <div className="p-4">Plan not found or invalid type.</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Bucket Plan Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="bucket-plan-total-hours">Total Hours in Bucket</Label>
              <Input
                id="bucket-plan-total-hours" type="number"
                value={totalHours?.toString() || ''}
                onChange={handleNumberInputChange(setTotalHours)}
                placeholder="Enter total hours" disabled={saving} min={0} step={1}
                className={validationErrors.totalHours ? 'border-red-500' : ''}
              />
              {validationErrors.totalHours && <p className="text-sm text-red-500 mt-1">{validationErrors.totalHours}</p>}
              {!validationErrors.totalHours && <p className="text-sm text-muted-foreground mt-1">Hours included per billing period.</p>}
            </div>

            <div>
              <Label htmlFor="bucket-plan-billing-period">Billing Period</Label>
              <CustomSelect
                id="bucket-plan-billing-period"
                options={BILLING_FREQUENCY_OPTIONS}
                onValueChange={() => {}} // Value comes from plan, maybe disable or just display
                value={billingPeriod}
                placeholder="Select period"
                className="w-full"
                disabled={true} // Typically set on the plan level, not config
              />
              <p className="text-sm text-muted-foreground mt-1">Frequency the bucket resets (set on plan).</p>
            </div>

            <div>
              <Label htmlFor="bucket-plan-overage-rate">Overage Rate per Hour</Label>
              <Input
                id="bucket-plan-overage-rate" type="number"
                value={overageRate?.toString() || ''}
                onChange={handleNumberInputChange(setOverageRate)}
                placeholder="Enter overage rate" disabled={saving} min={0} step={0.01}
                className={validationErrors.overageRate ? 'border-red-500' : ''}
              />
              {validationErrors.overageRate && <p className="text-sm text-red-500 mt-1">{validationErrors.overageRate}</p>}
              {!validationErrors.overageRate && <p className="text-sm text-muted-foreground mt-1">Rate for hours exceeding the bucket.</p>}
            </div>

            {/* Service Selection - Include if the primary bucket service is set here */}
            {/* <div>
              <Label htmlFor="bucket-plan-service">Primary Service</Label>
              <CustomSelect
                id="bucket-plan-service"
                options={serviceOptions}
                onValueChange={setServiceCatalogId} // Adjust state update logic
                value={serviceCatalogId}
                placeholder={loading ? "Loading services..." : "Select service"}
                className={`w-full ${validationErrors.serviceCatalogId ? 'border-red-500' : ''}`}
                disabled={saving || loading || services.length === 0}
              />
              {validationErrors.serviceCatalogId && <p className="text-sm text-red-500 mt-1">{validationErrors.serviceCatalogId}</p>}
              {!validationErrors.serviceCatalogId && <p className="text-sm text-muted-foreground mt-1">The main service this bucket applies to.</p>}
            </div> */}
          </div>

          <div className="flex items-center space-x-2 pt-4">
            <Switch
              id="bucket-plan-rollover"
              checked={allowRollover}
              onCheckedChange={setAllowRollover}
              disabled={saving}
            />
            <Label htmlFor="bucket-plan-rollover" className="cursor-pointer">
              Allow unused hours to roll over
            </Label>
          </div>
           <p className="text-sm text-muted-foreground pl-8">If enabled, unused hours carry over to the next billing period.</p>


          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button id="save-bucket-config-button" onClick={handleSave} disabled={saving || Object.values(validationErrors).some(e => e)}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Applicable Services</CardTitle>
          </CardHeader>
          <CardContent>
              <GenericPlanServicesList planId={planId} />
          </CardContent>
      </Card>
    </div>
  );
}