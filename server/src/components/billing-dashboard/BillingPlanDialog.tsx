// server/src/components/billing-dashboard/BillingPlanDialog.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import CustomSelect from '../ui/CustomSelect';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';

import { createBillingPlan, updateBillingPlan, getBillingPlans } from 'server/src/lib/actions/billingPlanAction';
import { createBucketPlan, getBucketPlanByPlanId, updateBucketPlan } from 'server/src/lib/actions/bucketPlanAction';
import { IBillingPlan, IBucketPlan, IService } from 'server/src/interfaces/billing.interfaces';
import { addServiceToPlan as addPlanService } from 'server/src/lib/actions/planServiceActions';
import { useTenant } from '../TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS, PLAN_TYPE_OPTIONS } from 'server/src/constants/billing';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getPlanServices } from 'server/src/lib/actions/planServiceActions';
import OverlapWarningDialog from './disambiguation/OverlapWarningDialog';
import { PlanTypeSelector, PlanType } from './plan-types/PlanTypeSelector';
import { FixedPlanConfigPanel } from './plan-types/FixedPlanConfigPanel';
import { HourlyPlanConfigPanel } from './plan-types/HourlyPlanConfigPanel';
import { UsagePlanConfigPanel } from './plan-types/UsagePlanConfigPanel';
import { BucketPlanConfigPanel } from './plan-types/BucketPlanConfigPanel';

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'per_unit'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];
interface BillingPlanDialogProps {
  onPlanAdded: () => void;
  editingPlan?: IBillingPlan | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function BillingPlanDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: BillingPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState(editingPlan?.plan_name || '');
  const [billingFrequency, setBillingFrequency] = useState(editingPlan?.billing_frequency || '');
  const [planType, setPlanType] = useState<PlanType>(editingPlan?.plan_type as PlanType || 'Fixed');
  const [isCustom, setIsCustom] = useState(editingPlan?.is_custom || false);
  const tenant = useTenant()!;
  const [activeTab, setActiveTab] = useState('basic');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  const [showOverlapWarning, setShowOverlapWarning] = useState(false);
  const [overlappingServices, setOverlappingServices] = useState<Array<{
    service: IService;
    existingPlans: IBillingPlan[];
  }>>([]);
  const [pendingPlanData, setPendingPlanData] = useState<any>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [isAddingServices, setIsAddingServices] = useState(false);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Plan type specific state
  // Fixed plan
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>('start');
  const [fixedPlanServiceId, setFixedPlanServiceId] = useState<string>('');

  // Hourly plan
  const [hourlyRate, setHourlyRate] = useState<number | undefined>(undefined);
  const [minimumBillableTime, setMinimumBillableTime] = useState<number>(15);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number>(15);
  const [enableOvertime, setEnableOvertime] = useState<boolean>(false);
  const [overtimeRate, setOvertimeRate] = useState<number | undefined>(undefined);
  const [overtimeThreshold, setOvertimeThreshold] = useState<number>(40);
  const [enableAfterHoursRate, setEnableAfterHoursRate] = useState<boolean>(false);
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState<number>(1.5);
  const [userTypeRates, setUserTypeRates] = useState<Array<{ userType: string, rate: number }>>([]);

  // Usage plan
  const [usageBaseRate, setUsageBaseRate] = useState<number | undefined>(undefined);
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('Unit');
  const [enableTieredPricing, setEnableTieredPricing] = useState<boolean>(false);
  const [minimumUsage, setMinimumUsage] = useState<number>(0);
  const [tiers, setTiers] = useState<Array<{ id: string, fromAmount: number, toAmount: number | null, rate: number }>>([]);

  // Bucket plan
  const [totalHours, setTotalHours] = useState<number>(40);
  const [bucketBillingPeriod, setBucketBillingPeriod] = useState<string>('monthly');
  const [overageRate, setOverageRate] = useState<number>(0);
  const [serviceCatalogId, setServiceCatalogId] = useState<string>('');
  const [allowRollover, setAllowRollover] = useState<boolean>(false);

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

  // Update form when editingPlan changes
  useEffect(() => {
    if (editingPlan) {
      setPlanName(editingPlan.plan_name);
      setBillingFrequency(editingPlan.billing_frequency);
      setPlanType(editingPlan.plan_type as PlanType);
      setIsCustom(editingPlan.is_custom);
      setOpen(true);

      // Load plan-specific configuration from the database
      const loadBucketPlanData = async () => {
        if (editingPlan.plan_type === 'Bucket' && editingPlan.plan_id) {
          try {
            const bucketPlan = await getBucketPlanByPlanId(editingPlan.plan_id);
            if (bucketPlan) {
              setTotalHours(bucketPlan.total_hours);
              setBucketBillingPeriod(bucketPlan.billing_period);
              setOverageRate(bucketPlan.overage_rate);
              // In a real implementation, you would also load the service_catalog_id
              // and allowRollover settings from the database
            }
          } catch (error) {
            console.error('Error loading bucket plan data:', error);
          }
        }
      };

      loadBucketPlanData();
    }
  }, [editingPlan]);

  // Load available services
  useEffect(() => {
    const loadServices = async () => {
      setIsLoading(true);
      try {
        const services = await getServices();
        setAvailableServices(services);
      } catch (error) {
        console.error('Error loading services:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadServices();
  }, []);

  const handlePlanTypeChange = (value: string) => {
    if (['Fixed', 'Bucket', 'Hourly', 'Usage'].includes(value)) {
      setPlanType(value as PlanType);
    }
  };

  // Validate form based on plan type
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Basic validation for all plan types
    if (!planName.trim()) {
      errors.planName = 'Plan name is required';
    }

    if (!billingFrequency) {
      errors.billingFrequency = 'Billing frequency is required';
    }

    // Plan type specific validation
    switch (planType) {
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

  // Check for service overlaps before saving
  const checkForServiceOverlaps = useCallback(async () => {
    // Only check for overlaps if we're adding services to a plan
    if (planType === 'Fixed' && !fixedPlanServiceId) return [];

    try {
      // Get all services that would be added to this plan
      const servicesToCheck: string[] = [];

      if (planType === 'Fixed' && fixedPlanServiceId) {
        servicesToCheck.push(fixedPlanServiceId);
      } else if (planType === 'Bucket' && serviceCatalogId) {
        servicesToCheck.push(serviceCatalogId);
      }

      // If no services to check, return empty array
      if (servicesToCheck.length === 0) return [];

      // Get all existing plans
      const allPlans = await getBillingPlans();
      const overlaps: Array<{
        service: IService;
        existingPlans: IBillingPlan[];
      }> = [];

      // Get all services
      const allServices = await getServices();

      // Check each service against all plans
      for (const serviceId of servicesToCheck) {
        const service = allServices.find(s => s.service_id === serviceId);
        if (!service) continue;

        const plansWithService: IBillingPlan[] = [];

        // Skip the current plan if we're editing
        for (const plan of allPlans) {
          if (editingPlan?.plan_id === plan.plan_id) continue;
          if (!plan.plan_id) continue;

          const planServices = await getPlanServices(plan.plan_id);
          if (planServices.some(ps => ps.service_id === serviceId)) {
            plansWithService.push(plan);
          }
        }

        if (plansWithService.length > 0) {
          overlaps.push({
            service,
            existingPlans: plansWithService
          });
        }
      }

      return overlaps;
    } catch (error) {
      console.error('Error checking for service overlaps:', error);
      return [];
    }
  }, [planType, fixedPlanServiceId, serviceCatalogId, editingPlan]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const errors = validateForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);
      return;
    }

    // Check for service overlaps
    const overlaps = await checkForServiceOverlaps();

    if (overlaps.length > 0) {
      setOverlappingServices(overlaps);
      setShowOverlapWarning(true);

      // Store the plan data to use if the user confirms
      const planData = {
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        plan_type: planType,
        tenant: tenant
      };

      setPendingPlanData(planData);
      return;
    }

    // If no overlaps, proceed with saving
    await savePlan();
  };

  const savePlan = async () => {
    try {
      const planData = pendingPlanData || {
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        plan_type: planType,
        tenant: tenant
      };

      let planId: string | undefined;

      if (editingPlan?.plan_id) {
        await updateBillingPlan(editingPlan.plan_id, planData);
        planId = editingPlan.plan_id;
      } else {
        const newPlan = await createBillingPlan(planData);
        planId = newPlan.plan_id;
      }

      // Save plan-specific configuration
      if (planId) {
        if (planType === 'Bucket') {
          const bucketPlanData: Omit<IBucketPlan, 'bucket_plan_id'> & { service_catalog_id: string } = {
            plan_id: planId,
            total_hours: totalHours,
            billing_period: bucketBillingPeriod,
            overage_rate: overageRate,
            tenant: tenant,
            service_catalog_id: serviceCatalogId || 'default'
          };

          if (editingPlan?.plan_id) {
            // If editing an existing plan, check if bucket plan exists and update it
            try {
              const existingBucketPlan = await getBucketPlanByPlanId(planId);
              if (existingBucketPlan) {
                await updateBucketPlan(existingBucketPlan.bucket_plan_id, bucketPlanData);
              } else {
                await createBucketPlan(bucketPlanData);
              }
            } catch (error) {
              console.error('Error updating bucket plan:', error);
              throw new Error('Failed to update bucket plan');
            }
          } else {
            // If creating a new plan
            await createBucketPlan(bucketPlanData);
          }
        }

        // Add selected services to the plan
        if (selectedServices.length > 0) {
          setIsAddingServices(true);
          try {
            // Get all services to determine default rates
            const allServices = await getServices();
            
            // Add each selected service to the plan
            for (const serviceId of selectedServices) {
              const serviceToAdd = allServices.find(s => s.service_id === serviceId);
              if (serviceToAdd) {
                try {
                  await addPlanService(
                    planId,
                    serviceId,
                    1, // default quantity
                    serviceToAdd.default_rate // use default rate
                  );
                } catch (serviceError) {
                  console.error(`Error adding service ${serviceId} to plan:`, serviceError);
                  // Continue with other services even if one fails
                }
              }
            }
          } catch (servicesError) {
            console.error('Error adding services to plan:', servicesError);
            // Don't throw here to allow plan creation to succeed even if service addition fails
          } finally {
            setIsAddingServices(false);
          }
        }
      }

      // Clear form fields and close dialog
      resetForm();
      setOpen(false);
      onPlanAdded();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving billing plan:', error);
      setValidationErrors({
        general: `Failed to save billing plan: ${error instanceof Error ? error.message : String(error)}`
      });
      setShowValidationSummary(true);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setBillingFrequency('');
    setPlanType('Fixed');
    setIsCustom(false);
    setSelectedServices([]);

    // Reset Fixed plan state
    setBaseRate(undefined);
    setEnableProration(false);
    setBillingCycleAlignment('start');
    setFixedPlanServiceId('');

    // Reset Hourly plan state
    setHourlyRate(undefined);
    setMinimumBillableTime(15);
    setRoundUpToNearest(15);
    setEnableOvertime(false);
    setOvertimeRate(undefined);
    setOvertimeThreshold(40);
    setEnableAfterHoursRate(false);
    setAfterHoursMultiplier(1.5);
    setUserTypeRates([]);

    // Reset Usage plan state
    setUsageBaseRate(undefined);
    setUnitOfMeasure('Unit');
    setEnableTieredPricing(false);
    setMinimumUsage(0);
    setTiers([]);

    // Reset Bucket plan state
    setTotalHours(40);
    setBucketBillingPeriod('monthly');
    setOverageRate(0);
    setServiceCatalogId('');
    setAllowRollover(false);
  };

  const handleClose = () => {
    resetForm();
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  const handleOverlapConfirm = async () => {
    setShowOverlapWarning(false);
    await savePlan();
  };

  const handleOverlapCancel = () => {
    setShowOverlapWarning(false);
    setPendingPlanData(null);
  };

  return (<>
    <Dialog.Root
      open={open || !!editingPlan}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        } else if (editingPlan) {
          setPlanName(editingPlan.plan_name);
          setBillingFrequency(editingPlan.billing_frequency);
          setPlanType(editingPlan.plan_type as PlanType);
          setIsCustom(editingPlan.is_custom);
        }
        setOpen(isOpen);
      }}
    >
      {triggerButton && (
        <Dialog.Trigger asChild>
          {triggerButton}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-2">
            {editingPlan ? 'Edit Billing Plan' : 'Add New Billing Plan'}
            {showValidationSummary && Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="mt-2">
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
          </Dialog.Title>
          <form onSubmit={handleSubmit}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="basic">Basic Information</TabsTrigger>
                <TabsTrigger value="config">Plan Configuration</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4">
                <div className="mb-4">
                  <Label htmlFor="plan-name">Plan Name</Label>
                  <Input
                    id="plan-name"
                    type="text"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder="Enter plan name"
                    required
                    className={validationErrors.planName ? 'border-red-500' : ''}
                  />
                  {validationErrors.planName && (
                    <p className="text-red-500 text-xs mt-1">{validationErrors.planName}</p>
                  )}
                </div>
                <div className="mb-4">
                  <Label htmlFor="billing-frequency">Billing Frequency</Label>
                  <CustomSelect
                    id="billing-frequency"
                    options={BILLING_FREQUENCY_OPTIONS}
                    onValueChange={setBillingFrequency}
                    value={billingFrequency}
                    placeholder="Select billing frequency"
                    className={`w-full ${validationErrors.billingFrequency ? 'border-red-500' : ''}`}
                    required
                  />
                  {validationErrors.billingFrequency && (
                    <p className="text-red-500 text-xs mt-1">{validationErrors.billingFrequency}</p>
                  )}
                </div>
                <div className="mb-4">
                  <PlanTypeSelector
                    value={planType}
                    onChange={setPlanType}
                    className="w-full"
                    showDescriptions={true}
                    showCards={true}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is-custom"
                    checked={isCustom}
                    onChange={(e) => setIsCustom(e.target.checked)}
                  />
                  <Label htmlFor="is-custom" className="cursor-pointer">
                    Is Custom Plan
                  </Label>
                </div>
              </TabsContent>

              <TabsContent value="config" className="space-y-4">
                {planType === 'Fixed' && (
                  <FixedPlanConfigPanel
                    baseRate={baseRate}
                    onBaseRateChange={setBaseRate}
                    enableProration={enableProration}
                    onEnableProrateChange={setEnableProration}
                    billingCycleAlignment={billingCycleAlignment}
                    onBillingCycleAlignmentChange={setBillingCycleAlignment}
                    serviceCatalogId={fixedPlanServiceId}
                    onServiceCatalogIdChange={(id) => {
                      setFixedPlanServiceId(id);
                      // Add to selected services if not already included
                      if (id && !selectedServices.includes(id)) {
                        setSelectedServices([...selectedServices, id]);
                      }
                    }}
                  />
                )}

                {planType === 'Hourly' && (
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

                {planType === 'Usage' && (
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

                {planType === 'Bucket' && (
                  <BucketPlanConfigPanel
                    totalHours={totalHours}
                    onTotalHoursChange={setTotalHours}
                    billingPeriod={bucketBillingPeriod}
                    onBillingPeriodChange={setBucketBillingPeriod}
                    overageRate={overageRate}
                    onOverageRateChange={setOverageRate}
                    serviceCatalogId={serviceCatalogId}
                    onServiceCatalogIdChange={(id) => {
                      setServiceCatalogId(id);
                      // Add to selected services if not already included
                      if (id && !selectedServices.includes(id)) {
                        setSelectedServices([...selectedServices, id]);
                      }
                    }}
                    allowRollover={allowRollover}
                    onAllowRolloverChange={setAllowRollover}
                    validationErrors={{
                      totalHours: validationErrors.totalHours,
                      overageRate: validationErrors.overageRate
                    }}
                  />
                )}
                {/* Service Selection Section */}
                <div className="mt-6 border-t pt-4">
                  <h4 className="text-md font-medium mb-2">Additional Services</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Select additional services to include in this plan:
                  </p>
                  
                  <div className="max-h-60 overflow-y-auto border rounded-md p-2">
                    {isLoading ? (
                      <div className="text-center py-4">Loading services...</div>
                    ) : (
                      <div className="space-y-2">
                        {availableServices?.map((service: IService) => (
                          <div
                            key={service.service_id}
                            className="flex items-center space-x-2 p-2 border rounded hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              id={`service-${service.service_id}`}
                              checked={selectedServices.includes(service.service_id!)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedServices([...selectedServices, service.service_id!]);
                                } else {
                                  setSelectedServices(selectedServices.filter(id => id !== service.service_id));
                                }
                              }}
                            />
                            <label htmlFor={`service-${service.service_id}`} className="flex-grow cursor-pointer flex flex-col">
                              <span>{service.service_name}</span>
                              <span className="text-xs text-gray-400">
                                Category: {service.service_type} | Method: {BILLING_METHOD_OPTIONS.find((opt: { value: string; label: string }) => opt.value === service.billing_method)?.label || service.billing_method}
                              </span>
                            </label>
                            <span className="text-sm text-gray-600">${(service.default_rate / 100).toFixed(2)}</span> {/* Display rate in dollars */}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {selectedServices.length > 0 && (
                    <div className="mt-2 text-sm text-blue-600">
                      {selectedServices.length} service{selectedServices.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                id="cancel-billing-plan-button"
                type="button"
                variant="outline"
                onClick={handleClose}
                className="bg-white hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button id='save-billing-plan-button' type="submit" disabled={isAddingServices}>
                {isAddingServices
                  ? 'Adding Services...'
                  : editingPlan
                    ? 'Update Plan'
                    : 'Save Plan'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <OverlapWarningDialog
      isOpen={showOverlapWarning}
      onClose={handleOverlapCancel}
      onConfirm={handleOverlapConfirm}
      overlappingServices={overlappingServices}
      currentPlanType={planType}
    />
  </>
  );
}
