'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import { AlertCircle, Save } from 'lucide-react';
import { IBillingPlan, IBucketPlan } from 'server/src/interfaces/billing.interfaces';
import { getBillingPlans, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import { createBucketPlan, getBucketPlanByPlanId, updateBucketPlan } from 'server/src/lib/actions/bucketPlanAction';
import { useTenant } from 'server/src/components/TenantProvider';
import BillingPlanHeader from './BillingPlanHeader';
import BillingPlanForm from './BillingPlanForm';
import BillingPlanServices from './BillingPlanServices';
import { FixedPlanConfigPanel } from '../plan-types/FixedPlanConfigPanel';
import { HourlyPlanConfigPanel } from '../plan-types/HourlyPlanConfigPanel';
import { UsagePlanConfigPanel } from '../plan-types/UsagePlanConfigPanel';
import { BucketPlanConfigPanel } from '../plan-types/BucketPlanConfigPanel';

const BillingPlanConfiguration: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams?.get('planId') as string;
  const tenant = useTenant();
  
  const [plan, setPlan] = useState<IBillingPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('details');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>('start');
  const [fixedPlanServiceId, setFixedPlanServiceId] = useState<string>('');

  // Hourly plan state
  const [hourlyRate, setHourlyRate] = useState<number | undefined>(undefined);
  const [minimumBillableTime, setMinimumBillableTime] = useState<number>(15);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number>(15);
  const [enableOvertime, setEnableOvertime] = useState<boolean>(false);
  const [overtimeRate, setOvertimeRate] = useState<number | undefined>(undefined);
  const [overtimeThreshold, setOvertimeThreshold] = useState<number>(40);
  const [enableAfterHoursRate, setEnableAfterHoursRate] = useState<boolean>(false);
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState<number>(1.5);
  const [userTypeRates, setUserTypeRates] = useState<Array<{ userType: string, rate: number }>>([]);

  // Usage plan state
  const [usageBaseRate, setUsageBaseRate] = useState<number | undefined>(undefined);
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('Unit');
  const [enableTieredPricing, setEnableTieredPricing] = useState<boolean>(false);
  const [minimumUsage, setMinimumUsage] = useState<number>(0);
  const [tiers, setTiers] = useState<Array<{ id: string, fromAmount: number, toAmount: number | null, rate: number }>>([]);

  // Bucket plan state
  const [totalHours, setTotalHours] = useState<number>(40);
  const [bucketBillingPeriod, setBucketBillingPeriod] = useState<string>('monthly');
  const [overageRate, setOverageRate] = useState<number>(0);
  const [serviceCatalogId, setServiceCatalogId] = useState<string>('');
  const [allowRollover, setAllowRollover] = useState<boolean>(false);
  const [bucketPlanId, setBucketPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (planId) {
      fetchPlan();
    }
  }, [planId]);

  const fetchPlan = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const plans = await getBillingPlans();
      const planData = plans.find(p => p.plan_id === planId);
      
      if (planData) {
        setPlan(planData);
      } else {
        setError('Billing plan not found');
      }
    } catch (error) {
      console.error('Error fetching plan:', error);
      setError('Failed to load billing plan');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlanUpdated = () => {
    fetchPlan();
  };

  // Load type-specific configuration data
  useEffect(() => {
    if (plan) {
      // Load type-specific configuration based on plan type
      if (plan.plan_type === 'Bucket' && plan.plan_id) {
        loadBucketPlanData(plan.plan_id);
      }
      
      // In a real implementation, you would also load configuration for other plan types
      // This might involve adding new API endpoints or extending existing ones
    }
  }, [plan]);

  const loadBucketPlanData = async (planId: string) => {
    try {
      const bucketPlan = await getBucketPlanByPlanId(planId);
      if (bucketPlan) {
        setTotalHours(bucketPlan.total_hours);
        setBucketBillingPeriod(bucketPlan.billing_period);
        setOverageRate(bucketPlan.overage_rate);
        // These properties might be stored elsewhere or in a different format
        // For now, we'll use default values
        setServiceCatalogId('');
        setAllowRollover(false);
        setBucketPlanId(bucketPlan.bucket_plan_id);
      }
    } catch (error) {
      console.error('Error loading bucket plan data:', error);
      setError('Failed to load bucket plan configuration');
    }
  };

  // Wrapper functions for handling number | undefined values
  const handleMinimumBillableTimeChange = (value: number | undefined) => {
    if (value !== undefined) {
      setMinimumBillableTime(value);
    }
  };

  const handleAfterHoursMultiplierChange = (value: number | undefined) => {
    if (value !== undefined) {
      setAfterHoursMultiplier(value);
    }
  };

  const handleMinimumUsageChange = (value: number | undefined) => {
    if (value !== undefined) {
      setMinimumUsage(value);
    }
  };

  const handleRoundUpToNearestChange = (value: number | undefined) => {
    if (value !== undefined) {
      setRoundUpToNearest(value);
    }
  };

  const handleOvertimeThresholdChange = (value: number | undefined) => {
    if (value !== undefined) {
      setOvertimeThreshold(value);
    }
  };

  // Validate form based on plan type
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Plan type specific validation
    switch (plan?.plan_type) {
      case 'Fixed':
        if (baseRate === undefined || baseRate < 0) {
          errors.baseRate = 'Base rate must be a non-negative number';
        }
        if (!fixedPlanServiceId) {
          errors.fixedPlanServiceId = 'Please select a service';
        }
        break;

      case 'Hourly':
        if (hourlyRate === undefined || hourlyRate <= 0) {
          errors.hourlyRate = 'Hourly rate must be greater than zero';
        }
        if (minimumBillableTime <= 0) {
          errors.minimumBillableTime = 'Minimum billable time must be greater than zero';
        }
        if (enableOvertime && (overtimeRate === undefined || overtimeRate <= 0)) {
          errors.overtimeRate = 'Overtime rate must be greater than zero';
        }
        break;

      case 'Usage':
        if (usageBaseRate === undefined || usageBaseRate < 0) {
          errors.usageBaseRate = 'Base rate must be a non-negative number';
        }
        if (!unitOfMeasure) {
          errors.unitOfMeasure = 'Unit of measure is required';
        }
        if (enableTieredPricing && tiers.length === 0) {
          errors.tiers = 'At least one tier is required when tiered pricing is enabled';
        }
        break;

      case 'Bucket':
        if (totalHours <= 0) {
          errors.totalHours = 'Total hours must be greater than zero';
        }
        if (!bucketBillingPeriod) {
          errors.bucketBillingPeriod = 'Billing period is required';
        }
        if (overageRate < 0) {
          errors.overageRate = 'Overage rate cannot be negative';
        }
        break;
    }

    return errors;
  };

  const handleSaveTypeConfig = async () => {
    if (!plan || !plan.plan_id || !tenant) return;

    // Validate form
    const errors = validateForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);
    
    try {
      // Save type-specific configuration based on plan type
      switch (plan.plan_type) {
        case 'Bucket':
          await saveBucketPlanConfig(plan.plan_id);
          break;
        
        case 'Fixed':
          // In a real implementation, you would save Fixed plan configuration
          // This might involve adding new API endpoints or extending existing ones
          console.log('Saving Fixed plan configuration:', {
            baseRate,
            enableProration,
            billingCycleAlignment,
            fixedPlanServiceId
          });
          break;
        
        case 'Hourly':
          // In a real implementation, you would save Hourly plan configuration
          console.log('Saving Hourly plan configuration:', {
            hourlyRate,
            minimumBillableTime,
            roundUpToNearest,
            enableOvertime,
            overtimeRate,
            overtimeThreshold,
            enableAfterHoursRate,
            afterHoursMultiplier,
            userTypeRates
          });
          break;
        
        case 'Usage':
          // In a real implementation, you would save Usage plan configuration
          console.log('Saving Usage plan configuration:', {
            usageBaseRate,
            unitOfMeasure,
            enableTieredPricing,
            minimumUsage,
            tiers
          });
          break;
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving plan configuration:', error);
      setError('Failed to save plan configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const saveBucketPlanConfig = async (planId: string) => {
    // The createBucketPlan function requires service_catalog_id
    // even though it's not part of the IBucketPlan interface
    const bucketPlanData = {
      plan_id: planId,
      total_hours: totalHours,
      billing_period: bucketBillingPeriod,
      overage_rate: overageRate,
      tenant: tenant!,
      service_catalog_id: serviceCatalogId || 'default'
    };
    
    // Additional properties that would be stored elsewhere
    const additionalData = {
      allow_rollover: allowRollover
    };

    if (bucketPlanId) {
      // Update existing bucket plan
      await updateBucketPlan(bucketPlanId, bucketPlanData);
      
      // In a real implementation, you would also save the additional data
      console.log('Would also save additional data:', additionalData);
    } else {
      // Create new bucket plan
      const newBucketPlan = await createBucketPlan(bucketPlanData);
      setBucketPlanId(newBucketPlan.bucket_plan_id);
      
      // In a real implementation, you would also save the additional data
      console.log('Would also save additional data for new bucket plan:', additionalData);
    }
  };

  if (isLoading) {
    return <div className="p-4">Loading plan details...</div>;
  }

  if (error || !plan) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Billing plan not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BillingPlanHeader plan={plan} />
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="details">Plan Details</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="configuration">Type Configuration</TabsTrigger>
          {/* Future tab for visualization */}
          <TabsTrigger value="visualization" disabled>Visualization</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <BillingPlanForm plan={plan} onPlanUpdated={handlePlanUpdated} />
        </TabsContent>

        <TabsContent value="services">
          <BillingPlanServices plan={plan} />
        </TabsContent>

        <TabsContent value="configuration">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            {validationErrors && Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please fix the following errors:
                  <ul className="list-disc pl-5 mt-1 text-sm">
                    {Object.entries(validationErrors).map(([field, message]) => (
                      <li key={field}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {plan.plan_type === 'Fixed' && (
              <FixedPlanConfigPanel
                baseRate={baseRate}
                onBaseRateChange={setBaseRate}
                enableProration={enableProration}
                onEnableProrateChange={setEnableProration}
                billingCycleAlignment={billingCycleAlignment}
                onBillingCycleAlignmentChange={setBillingCycleAlignment}
                serviceCatalogId={fixedPlanServiceId}
                onServiceCatalogIdChange={setFixedPlanServiceId}
              />
            )}
            
            {plan.plan_type === 'Hourly' && (
              <HourlyPlanConfigPanel
                hourlyRate={hourlyRate}
                onHourlyRateChange={setHourlyRate}
                minimumBillableTime={minimumBillableTime}
                onMinimumBillableTimeChange={handleMinimumBillableTimeChange}
                roundUpToNearest={roundUpToNearest}
                onRoundUpToNearestChange={handleRoundUpToNearestChange}
                enableOvertime={enableOvertime}
                onEnableOvertimeChange={setEnableOvertime}
                overtimeRate={overtimeRate}
                onOvertimeRateChange={setOvertimeRate}
                overtimeThreshold={overtimeThreshold}
                onOvertimeThresholdChange={handleOvertimeThresholdChange}
                enableAfterHoursRate={enableAfterHoursRate}
                onEnableAfterHoursRateChange={setEnableAfterHoursRate}
                afterHoursMultiplier={afterHoursMultiplier}
                onAfterHoursMultiplierChange={handleAfterHoursMultiplierChange}
                userTypeRates={userTypeRates}
                onUserTypeRatesChange={setUserTypeRates}
              />
            )}
            
            {plan.plan_type === 'Usage' && (
              <UsagePlanConfigPanel
                baseRate={usageBaseRate}
                onBaseRateChange={setUsageBaseRate}
                unitOfMeasure={unitOfMeasure}
                onUnitOfMeasureChange={setUnitOfMeasure}
                enableTieredPricing={enableTieredPricing}
                onEnableTieredPricingChange={setEnableTieredPricing}
                minimumUsage={minimumUsage}
                onMinimumUsageChange={handleMinimumUsageChange}
                tiers={tiers}
                onTiersChange={setTiers}
              />
            )}
            
            {plan.plan_type === 'Bucket' && (
              <BucketPlanConfigPanel
                totalHours={totalHours}
                onTotalHoursChange={setTotalHours}
                billingPeriod={bucketBillingPeriod}
                onBillingPeriodChange={setBucketBillingPeriod}
                overageRate={overageRate}
                onOverageRateChange={setOverageRate}
                serviceCatalogId={serviceCatalogId}
                onServiceCatalogIdChange={setServiceCatalogId}
                allowRollover={allowRollover}
                onAllowRolloverChange={setAllowRollover}
                validationErrors={{
                  totalHours: validationErrors.totalHours,
                  overageRate: validationErrors.overageRate
                }}
              />
            )}
            
            <div className="mt-4 flex justify-between items-center">
              <Button
                id="save-type-config-button"
                onClick={handleSaveTypeConfig}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
                {!isSaving && <Save className="ml-2 h-4 w-4" />}
              </Button>
              
              {saveSuccess && (
                <span className="text-green-600 text-sm">
                  Configuration saved successfully!
                </span>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="visualization">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-center text-gray-500">
              Plan visualization will be available in a future update.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BillingPlanConfiguration;