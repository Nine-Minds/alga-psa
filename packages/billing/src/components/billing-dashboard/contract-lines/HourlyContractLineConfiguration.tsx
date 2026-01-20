// server/src/components/billing-dashboard/HourlyPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, Trash2, Info, ChevronDown } from 'lucide-react';
import { Button, ButtonProps } from '@alga-psa/ui/components/Button'; // Import ButtonProps
import Spinner from '@alga-psa/ui/components/Spinner';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import * as Accordion from '@radix-ui/react-accordion';
import * as Tooltip from '@radix-ui/react-tooltip'; // Correct Radix UI import
// Removed incorrect import: import { TooltipContent, TooltipProvider, TooltipTrigger } from '@alga-psa/ui/components/Tooltip';
import { getContractLineById, updateContractLine } from '@alga-psa/billing/actions/contractLineAction';
import { BILLING_FREQUENCY_OPTIONS } from '@alga-psa/billing/constants/billing';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { getContractLineServicesWithConfigurations } from '@alga-psa/billing/actions/contractLineServiceActions'; // Corrected import path
import GenericPlanServicesList from './GenericContractLineServicesList';
import { IContractLine, IService as IBillingService } from '@alga-psa/types'; // Use IService from billing.interfaces
import { ServiceHourlyConfigForm } from './ServiceHourlyConfigForm';
import {
    upsertPlanServiceHourlyConfiguration, // Correct action import
    upsertUserTypeRatesForConfig // Added import for user type rates action
} from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';
import {
    IContractLineServiceHourlyConfig,
    IContractLineServiceConfiguration,
    IUserTypeRate
} from '@alga-psa/types';
// Removed incorrect import: import { IService } from '@alga-psa/types';
// Removed incorrect import: import { isDeepStrictEqual } from 'util';

// --- Local Deep Equality Helper ---
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  
  if (typeof a !== 'object') return a === b;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  
  // Both are objects at this point
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!isEqual(objA[key], objB[key])) return false;
  }
  
  return true;
}

// --- Local Type Definitions ---

// Combined interface for state management - using config_id
interface IPlanServiceWithHourlyConfig {
    config_id: string;       // ID of the specific configuration record
    service_id: string;      // ID of the service itself
    service?: IBillingService; // Use imported IService from billing.interfaces
    hourly_config: IContractLineServiceHourlyConfig | null; // Nullable initially - Null means not hourly configurable
    user_type_rates?: IUserTypeRate[]; // Add user type rates here
    isHourlyConfigurable: boolean; // Flag to indicate if the service *should* be hourly
}

// Define the expected shape of the plan object returned by getContractLineById for Hourly
type HourlyPlanData = IContractLine & {
    enable_overtime?: boolean;
    overtime_rate?: number;
    overtime_threshold?: number;
    enable_after_hours_rate?: boolean;
    after_hours_multiplier?: number;
    user_type_rates?: IUserTypeRate[];
    // Removed billing_period: billing_period?: string | null;
};

// --- Component ---

interface HourlyPlanConfigurationProps {
  contractLineId: string;
  className?: string;
}

export function HourlyPlanConfiguration({
  contractLineId,
  className = '',
}: HourlyPlanConfigurationProps) {
  // Plan-wide state
  const [plan, setPlan] = useState<HourlyPlanData | null>(null);
  const [initialPlanData, setInitialPlanData] = useState<Partial<HourlyPlanData>>({}); // For plan-wide change detection

  // Plan basics state for inline editing
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [isCustom, setIsCustom] = useState(false);
  const [planBasicsErrors, setPlanBasicsErrors] = useState<string[]>([]);
  const [isSavingBasics, setIsSavingBasics] = useState(false);
  const [isBasicsDirty, setIsBasicsDirty] = useState(false);
  const tenant = useTenant()!;

  const markBasicsDirty = () => setIsBasicsDirty(true);

  const [enableOvertime, setEnableOvertime] = useState<boolean>(false);
  const [overtimeRate, setOvertimeRate] = useState<number | undefined>(undefined);
  const [overtimeRateInput, setOvertimeRateInput] = useState<string>('');
  const [overtimeThreshold, setOvertimeThreshold] = useState<number | undefined>(40);
  const [enableAfterHoursRate, setEnableAfterHoursRate] = useState<boolean>(false);
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState<number | undefined>(1.5);
  const [afterHoursMultiplierInput, setAfterHoursMultiplierInput] = useState<string>('');
  // Removed plan-wide userTypeRates state: const [userTypeRates, setUserTypeRates] = useState<IUserTypeRate[]>([]);

  // Service-specific config state (using locally defined interface)
  const [serviceConfigs, setServiceConfigs] = useState<IPlanServiceWithHourlyConfig[]>([]);
  const [initialServiceConfigs, setInitialServiceConfigs] = useState<IPlanServiceWithHourlyConfig[]>([]);
  const [serviceValidationErrors, setServiceValidationErrors] = useState<Record<string, Record<string, string>>>({}); // { config_id: { field: error } }

  // UI State
  // Removed plan-wide user type rate UI state:
  // const [newUserType, setNewUserType] = useState('');
  // const [newUserTypeRate, setNewUserTypeRate] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); // General fetch error
  const [saveError, setSaveError] = useState<string | null>(null); // Save operation error
  const [isPlanWideSettingsOpen, setIsPlanWideSettingsOpen] = useState(false); // State for collapsible section

  // Plan-wide validation errors
  const [planValidationErrors, setPlanValidationErrors] = useState<{
    overtimeRate?: string;
    overtimeThreshold?: string;
    afterHoursMultiplier?: string;
    // Removed newUserTypeRate validation: newUserTypeRate?: string;
  }>({});

  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveError(null);
    setServiceValidationErrors({});
    setPlanValidationErrors({});
    try {
      // Fetch base plan details
      const fetchedPlan = await getContractLineById(contractLineId) as HourlyPlanData;
      if (!fetchedPlan || fetchedPlan.contract_line_type !== 'Hourly') {
        setError('Invalid plan type or plan not found.');
        setLoading(false);
        return;
      }
      setPlan(fetchedPlan);

      // Populate plan basics form fields
      setPlanName(fetchedPlan.contract_line_name);
      setBillingFrequency(fetchedPlan.billing_frequency);
      setIsCustom(fetchedPlan.is_custom ?? false);
      setIsBasicsDirty(false);

      // Set initial plan-wide states
      const initialData: Partial<HourlyPlanData> = {
          enable_overtime: fetchedPlan.enable_overtime ?? false,
          overtime_rate: fetchedPlan.overtime_rate,
          overtime_threshold: fetchedPlan.overtime_threshold ?? 40,
          enable_after_hours_rate: fetchedPlan.enable_after_hours_rate ?? false,
          after_hours_multiplier: fetchedPlan.after_hours_multiplier ?? 1.5,
          // user_type_rates are no longer fetched/set at the plan level
          // user_type_rates: fetchedPlan.user_type_rates || [],
          // Removed billing_period: fetchedPlan.billing_period,
      };
      setInitialPlanData(initialData);
      setEnableOvertime(initialData.enable_overtime!);
      setOvertimeRate(initialData.overtime_rate);
      if (initialData.overtime_rate !== undefined && initialData.overtime_rate !== null) {
        setOvertimeRateInput((initialData.overtime_rate / 100).toFixed(2));
      }
      setOvertimeThreshold(initialData.overtime_threshold);
      setEnableAfterHoursRate(initialData.enable_after_hours_rate!);
      setAfterHoursMultiplier(initialData.after_hours_multiplier);
      if (initialData.after_hours_multiplier !== undefined && initialData.after_hours_multiplier !== null) {
        setAfterHoursMultiplierInput(initialData.after_hours_multiplier.toFixed(2));
      }
      // Removed setting plan-wide userTypeRates state: setUserTypeRates(initialData.user_type_rates!);

      // Fetch services and their configurations using the correct action
      const servicesWithConfigsResult = await getContractLineServicesWithConfigurations(contractLineId);

      // Process results, mapping to IPlanServiceWithHourlyConfig
      const processedConfigs: IPlanServiceWithHourlyConfig[] = servicesWithConfigsResult.map((item) => {
        // Determine if the service *should* be hourly configurable
        const isHourlyService =
          item.service.billing_method === 'hourly' ||
          (item.service.billing_method === 'usage' &&
            item.service.unit_of_measure?.toLowerCase().includes('hour'));

        let hourlyConfig: IContractLineServiceHourlyConfig | null = null;
        let userTypeRatesForConfig: IUserTypeRate[] = []; // Initialize as empty array

        if (isHourlyService) {
          // If the service is hourly, check if existing config is hourly type
          if (item.configuration.configuration_type === 'Hourly' && item.typeConfig) {
            hourlyConfig = item.typeConfig as IContractLineServiceHourlyConfig;
            // IMPORTANT: Assuming getPlanServicesWithConfigurations now returns userTypeRates
            // nested within the item or typeConfig when type is Hourly. Adjust access as needed.
            // Example: userTypeRatesForConfig = item.userTypeRates || [];
            // Example: userTypeRatesForConfig = (item.typeConfig as any)?.userTypeRates || [];
            // For now, we'll assume they are fetched but need to be explicitly added to the state object.
            // Placeholder: Fetch them separately if needed (less efficient)
             userTypeRatesForConfig = item.userTypeRates || []; // Assuming it's returned at the item level

          } else {
            // If existing config isn't hourly OR typeConfig is missing, create default hourly config
            hourlyConfig = {
              config_id: item.configuration.config_id,
              hourly_rate: 0,
              minimum_billable_time: 15,
              round_up_to_nearest: 15,
              tenant: item.configuration.tenant,
              created_at: new Date(),
              updated_at: new Date(),
            };
            // User type rates will be empty for a newly defaulted config
            userTypeRatesForConfig = [];
          }
        }
        // If !isHourlyService, hourlyConfig remains null and userTypeRatesForConfig remains empty

        return {
          config_id: item.configuration.config_id,
          service_id: item.service.service_id,
          service: item.service,
          hourly_config: hourlyConfig,
          user_type_rates: userTypeRatesForConfig, // Store fetched/defaulted rates
          isHourlyConfigurable: isHourlyService,
        };
      });

      setServiceConfigs(processedConfigs);
      setInitialServiceConfigs(JSON.parse(JSON.stringify(processedConfigs))); // Deep copy

    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError('Failed to load plan configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [contractLineId]);

  // Callback to refresh data when services are added/removed
  const handleServicesChanged = useCallback(() => {
    console.log('Services changed, refetching plan data...');
    fetchPlanData();
  }, [fetchPlanData]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // Validate PLAN-WIDE inputs
  useEffect(() => {
    const newErrors: typeof planValidationErrors = {};
    if (enableOvertime && overtimeRate !== undefined && overtimeRate < 0) newErrors.overtimeRate = 'Overtime rate cannot be negative';
    if (enableOvertime && overtimeThreshold !== undefined && overtimeThreshold < 0) newErrors.overtimeThreshold = 'Overtime threshold cannot be negative';
    if (enableAfterHoursRate && afterHoursMultiplier !== undefined && afterHoursMultiplier < 1) newErrors.afterHoursMultiplier = 'After hours multiplier must be at least 1';
    // Removed newUserTypeRate validation: if (newUserTypeRate !== undefined && newUserTypeRate < 0) newErrors.newUserTypeRate = 'User type rate cannot be negative';

    // Only update state if errors have actually changed
    if (!isEqual(newErrors, planValidationErrors)) {
        setPlanValidationErrors(newErrors);
    }
  }, [enableOvertime, overtimeRate, overtimeThreshold, enableAfterHoursRate, afterHoursMultiplier, planValidationErrors]); // Removed newUserTypeRate from deps

  // --- Updated Handlers for Service Config State ---

  // Handler for changes to hourly fields (rate, min time, rounding)
  const handleHourlyFieldChange = useCallback((configId: string, field: keyof IContractLineServiceHourlyConfig, value: any) => {
    setServiceConfigs(prevConfigs =>
      prevConfigs.map(config => {
        if (config.config_id === configId && config.hourly_config) { // Ensure hourly_config exists
          const updatedHourlyConfig = {
            ...config.hourly_config,
            [field]: value,
          };
          return { ...config, hourly_config: updatedHourlyConfig };
        }
        return config;
      })
    );
    // Clear validation error for the specific field if needed (logic can be added here)
  }, []);

  // Handler for changes to the user_type_rates array for a specific config
  const handleUserTypeRatesChange = useCallback((configId: string, newUserTypeRates: IUserTypeRate[]) => {
      setServiceConfigs(prevConfigs =>
          prevConfigs.map(config =>
              config.config_id === configId
                  ? { ...config, user_type_rates: newUserTypeRates }
                  : config
          )
      );
  }, []);

  // Plan basics save/reset handlers
  const validatePlanBasics = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract line name');
    if (!billingFrequency) errors.push('Billing frequency');
    return errors;
  };

  const handleSavePlanBasics = async () => {
    const errors = validatePlanBasics();
    if (errors.length > 0) {
      setPlanBasicsErrors(errors);
      return;
    }

    setIsSavingBasics(true);
    setPlanBasicsErrors([]);
    try {
      const planData: Partial<HourlyPlanData> = {
        contract_line_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        tenant,
      };

      if (plan?.contract_line_id) {
        await updateContractLine(plan.contract_line_id, planData);
      }

      await fetchPlanData();
      setIsBasicsDirty(false);
    } catch (error) {
      console.error('Error saving contract line basics:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract line';
      setPlanBasicsErrors([errorMessage]);
    } finally {
      setIsSavingBasics(false);
    }
  };

  const handleResetPlanBasics = () => {
    if (plan) {
      setPlanName(plan.contract_line_name);
      setBillingFrequency(plan.billing_frequency);
      setIsCustom(plan.is_custom ?? false);
      setIsBasicsDirty(false);
      setPlanBasicsErrors([]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setServiceValidationErrors({}); // Clear previous service errors
    let hasPlanErrors = Object.values(planValidationErrors).some(e => e);
    // Note: Service validation is now primarily handled within the upsert action via Zod.

    if (hasPlanErrors) { // Only check plan errors client-side for now
        setSaveError("Cannot save, contract line-wide validation errors exist.");
        setSaving(false);
        return;
    }

    // --- 1. Identify Changed Service Configs ---
    const changedServiceConfigs: IPlanServiceWithHourlyConfig[] = [];
    serviceConfigs.forEach((currentConfig) => { // Removed index as it's not needed
        const initialConfig = initialServiceConfigs.find(ic => ic.config_id === currentConfig.config_id); // Find by config_id
        // Compare both hourly_config fields AND user_type_rates array
        const hourlyFieldsChanged = currentConfig.isHourlyConfigurable && initialConfig && currentConfig.hourly_config && !isEqual(currentConfig.hourly_config, initialConfig.hourly_config);
        const ratesChanged = !isEqual(currentConfig.user_type_rates, initialConfig?.user_type_rates); // Compare rates arrays

        if (hourlyFieldsChanged || ratesChanged) {
             changedServiceConfigs.push(currentConfig);
        }
    });

    // --- 2. Save Service Configs ---
    let serviceSaveFailed = false;
    try {
        for (const config of changedServiceConfigs) {
            // --- Save Hourly Config Fields ---
            if (config.isHourlyConfigurable && config.hourly_config) {
                // Check if hourly fields actually changed
                const initialConfig = initialServiceConfigs.find(ic => ic.config_id === config.config_id);
                if (!isEqual(config.hourly_config, initialConfig?.hourly_config)) {
                    await upsertPlanServiceHourlyConfiguration(
                        contractLineId,
                        config.service_id,
                        {
                            hourly_rate: config.hourly_config.hourly_rate ?? 0,
                            minimum_billable_time: config.hourly_config.minimum_billable_time ?? null,
                            round_up_to_nearest: config.hourly_config.round_up_to_nearest ?? null,
                        }
                    );
                }
            }

            // --- Save User Type Rates ---
            // Check if rates changed for this config
            const initialConfigForRates = initialServiceConfigs.find(ic => ic.config_id === config.config_id);
            if (!isEqual(config.user_type_rates, initialConfigForRates?.user_type_rates)) {
                 // Prepare rates for the backend action (remove unnecessary fields like rate_id)
                 const ratesToSave: Array<Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'tenant' | 'created_at' | 'updated_at'>> = (config.user_type_rates || []).map(r => ({
                     user_type: r.user_type,
                     rate: r.rate,
                 }));
                 // Call the new action
                 await upsertUserTypeRatesForConfig(config.config_id, ratesToSave);
            }
        }
        // Update initial state for services after successful save
        setInitialServiceConfigs(JSON.parse(JSON.stringify(serviceConfigs)));

    } catch (err: any) {
        serviceSaveFailed = true;
        console.error('Error saving service configuration:', err);
        // Extract Zod error messages if available
        const message = err.message?.includes("Validation Error:")
            ? err.message
            : `Failed to save service configuration: ${err.message || 'Please try again.'}`;
        setSaveError(message);
        // Potentially map Zod errors back to serviceValidationErrors state here if needed
    }

    if (serviceSaveFailed) {
        setSaving(false);
        return; // Stop if service saving failed
    }

    // --- 3. Save Plan-Wide Settings ---
    try {
        const planUpdatePayload: Partial<HourlyPlanData> = {};
        let planChanged = false;

        // Compare current state with initialPlanData
        if (enableOvertime !== initialPlanData.enable_overtime) {
            planUpdatePayload.enable_overtime = enableOvertime; planChanged = true;
        }
        if (enableOvertime && overtimeRate !== initialPlanData.overtime_rate) {
            planUpdatePayload.overtime_rate = overtimeRate; planChanged = true;
        }
        if (enableOvertime && overtimeThreshold !== initialPlanData.overtime_threshold) {
            planUpdatePayload.overtime_threshold = overtimeThreshold; planChanged = true;
        }
        if (!enableOvertime && initialPlanData.enable_overtime) {
             planUpdatePayload.overtime_rate = undefined;
             planUpdatePayload.overtime_threshold = undefined;
             planChanged = true;
        }

        if (enableAfterHoursRate !== initialPlanData.enable_after_hours_rate) {
            planUpdatePayload.enable_after_hours_rate = enableAfterHoursRate; planChanged = true;
        }
        if (enableAfterHoursRate && afterHoursMultiplier !== initialPlanData.after_hours_multiplier) {
            planUpdatePayload.after_hours_multiplier = afterHoursMultiplier; planChanged = true;
        }
         if (!enableAfterHoursRate && initialPlanData.enable_after_hours_rate) {
             planUpdatePayload.after_hours_multiplier = undefined;
             planChanged = true;
        }

        // Removed check/addition of plan-wide userTypeRates
        // if (!isEqual(userTypeRates, initialPlanData.user_type_rates)) {
        //     planUpdatePayload.user_type_rates = userTypeRates; planChanged = true;
        // }

        if (planChanged) {
            await updateContractLine(contractLineId, planUpdatePayload);
            // Update initial plan data after successful save
            setInitialPlanData(prev => ({ ...prev, ...planUpdatePayload }));
        }

        console.log("Configuration saved successfully!");
        // Clear save error on full success
        setSaveError(null);

    } catch (err: any) {
        console.error('Error saving plan-wide configuration:', err);
        setSaveError(`Failed to save plan-wide configuration: ${err.message || 'Please try again.'}`);
    } finally {
        setSaving(false);
    }
  };

  // Removed plan-wide user type rate handlers:
  // const handleAddUserTypeRate = () => { ... };
  // const handleRemoveUserTypeRate = (index: number) => { ... };


  const handleNumberInputChange = (setter: React.Dispatch<React.SetStateAction<number | undefined>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value === '' ? undefined : Number(e.target.value);
      if (value === undefined || !isNaN(value)) {
          setter(value);
      }
  };

  const userTypeOptions = [
    { value: 'technician', label: 'Technician' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'project_manager', label: 'Project Manager' },
    { value: 'admin', label: 'Administrator' }
  ];

  if (loading && !plan) {
    return <div className="flex justify-center items-center p-8"><Spinner size="sm" /></div>;
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
      return <div className="p-4">Contract line not found or invalid type.</div>;
  }

  const hasUnsavedPlanChanges = !isEqual(
      // Removed user_type_rates from plan-wide change detection
      { enable_overtime: enableOvertime, overtime_rate: overtimeRate, overtime_threshold: overtimeThreshold, enable_after_hours_rate: enableAfterHoursRate, after_hours_multiplier: afterHoursMultiplier },
      { enable_overtime: initialPlanData.enable_overtime, overtime_rate: initialPlanData.overtime_rate, overtime_threshold: initialPlanData.overtime_threshold, enable_after_hours_rate: initialPlanData.enable_after_hours_rate, after_hours_multiplier: initialPlanData.after_hours_multiplier }
  );
  // Include user_type_rates in service change detection
  const hasUnsavedServiceChanges = !isEqual(
      serviceConfigs.map(c => ({ hourly: c.hourly_config, rates: c.user_type_rates })),
      initialServiceConfigs.map(c => ({ hourly: c.hourly_config, rates: c.user_type_rates }))
  );
  const hasUnsavedChanges = hasUnsavedPlanChanges || hasUnsavedServiceChanges;

  return (
    <Tooltip.Provider> {/* Use Radix Provider */}
        <div className={`space-y-6 ${className}`}>
            {saveError && (
                <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{saveError}</AlertDescription>
                </Alert>
            )}

            {/* Contract Line Wide Settings (Overtime, After-Hours) */}
            <Accordion.Root type="single" collapsible value={isPlanWideSettingsOpen ? "plan-wide-settings" : ""} onValueChange={(value) => setIsPlanWideSettingsOpen(value === "plan-wide-settings")}>
                <Accordion.Item value="plan-wide-settings" className="border rounded-md overflow-hidden">
                    <Accordion.Header className="flex">
                         <Accordion.Trigger className="flex flex-1 items-center justify-between p-4 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180">
                            Contract Line Hourly Settings (Overtime, After-Hours)
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                        </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                        <CardContent className="space-y-6 p-4 border-t">
                            {/* User Type Rates section removed from here */}

                            {/* Overtime */}
                            <div className="space-y-3 mt-4"> {/* Added mt-4 */}
                                <div className="flex items-center space-x-2">
                                <Switch id="enable-overtime" checked={enableOvertime} onCheckedChange={setEnableOvertime} disabled={saving} />
                                <Label htmlFor="enable-overtime" className="cursor-pointer flex items-center">
                                    Enable Overtime Rates
                                    <Tooltip.Root delayDuration={100}>
                                        <Tooltip.Trigger asChild>
                                            <Button id="overtime-rate-tooltip-trigger" variant="ghost" size="sm" className="ml-1 h-5 w-5 p-0">
                                                <Info className="h-4 w-4 text-muted-foreground" />
                                            </Button>
                                        </Tooltip.Trigger>
                                         <Tooltip.Content side="top" className="max-w-xs bg-gray-800 text-white p-2 rounded shadow-lg text-sm z-50">
                                            <p>Apply a different rate when total hours worked within the contract line's billing period exceed a specified threshold.</p>
                                        </Tooltip.Content>
                                    </Tooltip.Root>
                                </Label>
                                </div>
                                {enableOvertime && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
                                    <div>
                                    <Label htmlFor="overtime-rate">Overtime Rate ($/hr)</Label>
                                    <div className="relative">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                      <Input
                                        id="overtime-rate"
                                        type="text"
                                        inputMode="decimal"
                                        value={overtimeRateInput}
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9.]/g, '');
                                          const decimalCount = (value.match(/\./g) || []).length;
                                          if (decimalCount <= 1) {
                                            setOvertimeRateInput(value);
                                          }
                                        }}
                                        onBlur={() => {
                                          if (overtimeRateInput.trim() === '' || overtimeRateInput === '.') {
                                            setOvertimeRateInput('');
                                            setOvertimeRate(undefined);
                                          } else {
                                            const dollars = parseFloat(overtimeRateInput) || 0;
                                            const cents = Math.round(dollars * 100);
                                            setOvertimeRate(cents);
                                            setOvertimeRateInput((cents / 100).toFixed(2));
                                          }
                                        }}
                                        placeholder="0.00"
                                        disabled={saving}
                                        className={`pl-10 ${planValidationErrors.overtimeRate ? 'border-red-500' : ''}`}
                                      />
                                    </div>
                                    {planValidationErrors.overtimeRate && <p className="text-sm text-red-500 mt-1">{planValidationErrors.overtimeRate}</p>}
                                    {!planValidationErrors.overtimeRate && <p className="text-sm text-muted-foreground mt-1">Rate applied after threshold.</p>}
                                    </div>
                                    <div>
                                    <Label htmlFor="overtime-threshold">Overtime Threshold (hrs/period)</Label>
                                    <Input
                                        id="overtime-threshold" type="number"
                                        value={overtimeThreshold?.toString() || ''}
                                        onChange={handleNumberInputChange(setOvertimeThreshold)}
                                        placeholder="40" disabled={saving} min={0} step={1}
                                        className={planValidationErrors.overtimeThreshold ? 'border-red-500' : ''}
                                    />
                                    {planValidationErrors.overtimeThreshold && <p className="text-sm text-red-500 mt-1">{planValidationErrors.overtimeThreshold}</p>}
                                    {!planValidationErrors.overtimeThreshold && <p className="text-sm text-muted-foreground mt-1">Hours before OT applies.</p>}
                                    </div>
                                </div>
                                )}
                            </div>

                            {/* After Hours */}
                            <div className="space-y-3 pt-3 border-t">
                                <div className="flex items-center space-x-2">
                                <Switch id="enable-after-hours" checked={enableAfterHoursRate} onCheckedChange={setEnableAfterHoursRate} disabled={saving} />
                                <Label htmlFor="enable-after-hours" className="cursor-pointer flex items-center">
                                    Enable After-Hours Rate Multiplier
                                    <Tooltip.Root delayDuration={100}>
                                        <Tooltip.Trigger asChild>
                                            <Button id="after-hours-tooltip-trigger" variant="ghost" size="sm" className="ml-1 h-5 w-5 p-0">
                                                <Info className="h-4 w-4 text-muted-foreground" />
                                            </Button>
                                        </Tooltip.Trigger>
                                        <Tooltip.Content side="top" className="max-w-xs bg-gray-800 text-white p-2 rounded shadow-lg text-sm z-50">
                                            <p>Apply a multiplier to the standard hourly rate for work performed outside of defined business hours (requires Business Hours configuration).</p>
                                        </Tooltip.Content>
                                    </Tooltip.Root>
                                </Label>
                                </div>
                                {enableAfterHoursRate && (
                                <div className="pl-8">
                                    <Label htmlFor="after-hours-multiplier">After-Hours Multiplier</Label>
                                    <Input
                                      id="after-hours-multiplier"
                                      type="text"
                                      inputMode="decimal"
                                      value={afterHoursMultiplierInput}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[^0-9.]/g, '');
                                        const decimalCount = (value.match(/\./g) || []).length;
                                        if (decimalCount <= 1) {
                                          setAfterHoursMultiplierInput(value);
                                        }
                                      }}
                                      onBlur={() => {
                                        if (afterHoursMultiplierInput.trim() === '' || afterHoursMultiplierInput === '.') {
                                          setAfterHoursMultiplierInput('1.5');
                                          setAfterHoursMultiplier(1.5);
                                        } else {
                                          const multiplier = parseFloat(afterHoursMultiplierInput) || 1.5;
                                          setAfterHoursMultiplier(multiplier);
                                          setAfterHoursMultiplierInput(multiplier.toFixed(2));
                                        }
                                      }}
                                      placeholder="1.5"
                                      disabled={saving}
                                      className={`w-full md:w-1/2 ${planValidationErrors.afterHoursMultiplier ? 'border-red-500' : ''}`}
                                    />
                                    {planValidationErrors.afterHoursMultiplier && <p className="text-sm text-red-500 mt-1">{planValidationErrors.afterHoursMultiplier}</p>}
                                    {!planValidationErrors.afterHoursMultiplier && <p className="text-sm text-muted-foreground mt-1">Multiplier for non-business hours (e.g., 1.5x).</p>}
                                </div>
                                )}
                            </div>
                        </CardContent>
                    </Accordion.Content>
                </Accordion.Item>
            </Accordion.Root>

            {/* Contract Line Basics - Inline Editing */}
            <Card>
                <CardHeader>
                    <CardTitle>Edit Contract Line: {plan?.contract_line_name || '...'} (Hourly)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {planBasicsErrors.length > 0 && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                <p className="font-medium mb-2">Please correct the following:</p>
                                <ul className="list-disc list-inside space-y-1">
                                    {planBasicsErrors.map((err, idx) => (
                                        <li key={idx}>{err}</li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    )}

                    <section className="space-y-4">
                        <div>
                            <h3 className="text-lg font-semibold">Contract Line Basics</h3>
                            <p className="text-sm text-gray-600">
                                Name the contract line and choose how it should bill by default.
                            </p>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <Label htmlFor="hourly-name">Contract Line Name *</Label>
                                <Input
                                    id="hourly-name"
                                    value={planName}
                                    onChange={(e) => {
                                        setPlanName(e.target.value);
                                        markBasicsDirty();
                                    }}
                                    placeholder="e.g. Time & Materials Support"
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="hourly-frequency">Billing Frequency *</Label>
                                <CustomSelect
                                    id="hourly-frequency"
                                    value={billingFrequency}
                                    onValueChange={(value) => {
                                        setBillingFrequency(value);
                                        markBasicsDirty();
                                    }}
                                    options={BILLING_FREQUENCY_OPTIONS}
                                    placeholder="Select billing frequency"
                                />
                            </div>
                        </div>
                    </section>

                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button
                            id="reset-hourly-plan-basics"
                            variant="outline"
                            onClick={handleResetPlanBasics}
                            disabled={isSavingBasics || !isBasicsDirty}
                        >
                            Reset
                        </Button>
                        <Button
                            id="save-hourly-plan-basics"
                            onClick={handleSavePlanBasics}
                            disabled={isSavingBasics || !isBasicsDirty}
                        >
                            {isSavingBasics ? 'Saving…' : 'Save Changes'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Service Specific Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>Service Rates & Settings</CardTitle>
                </CardHeader>
                <CardContent>
                    {serviceConfigs.length > 0 ? (
                        <Accordion.Root type="multiple" className="w-full space-y-2">
                            {serviceConfigs.map((serviceConfig) => (
                                // Use config_id as the key and value for the Accordion Item
                                <Accordion.Item key={serviceConfig.config_id} value={serviceConfig.config_id} className="border rounded-md overflow-hidden">
                                    <Accordion.Header className="flex">
                                        <Accordion.Trigger className="flex flex-1 items-center justify-between p-4 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180">
                                            {/* Use optional chaining for service name */}
                                            {serviceConfig.service?.service_name ?? `Service ID: ${serviceConfig.service_id}`}
                                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                                        </Accordion.Trigger>
                                    </Accordion.Header>
                                    <Accordion.Content className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                                        <div className="p-4 border-t">
                                            {/* Conditionally render form or message based on isHourlyConfigurable */}
                                            {serviceConfig.isHourlyConfigurable && serviceConfig.hourly_config ? (
                                                <ServiceHourlyConfigForm
                                                    configId={serviceConfig.config_id} // Pass the config_id
                                                    config={serviceConfig.hourly_config} // Pass hourly fields
                                                    userTypeRates={serviceConfig.user_type_rates || []} // Pass user type rates for this config
                                                    onHourlyFieldChange={(field: keyof IContractLineServiceHourlyConfig, value: any) => handleHourlyFieldChange(serviceConfig.config_id, field, value)}
                                                    onUserTypeRatesChange={(newRates: IUserTypeRate[]) => handleUserTypeRatesChange(serviceConfig.config_id, newRates)} // Pass handler for rates with types
                                                    validationErrors={serviceValidationErrors[serviceConfig.config_id] || {}}
                                                    disabled={saving}
                                                />
                                            ) : (
                                                <p className="text-muted-foreground text-sm">
                                                    This service (Billing Method: {serviceConfig.service?.billing_method || 'N/A'}) cannot be configured with specific hourly rates on this plan.
                                                </p>
                                            )}
                                        </div>
                                    </Accordion.Content>
                                </Accordion.Item>
                            ))}
                        </Accordion.Root>
                    ) : (
                        <p className="text-muted-foreground">No services are currently associated with this contract line.</p>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-end pt-4 sticky bottom-0 bg-background py-4 border-t border-border">
                <Button
                    id="save-hourly-config-button"
                    onClick={handleSave}
                    // Disable save if saving, no changes, or plan-wide errors exist. Service errors handled by action.
                    disabled={saving || !hasUnsavedChanges || Object.values(planValidationErrors).some(e => e)}
                >
                {saving ? <LoadingIndicator spinnerProps={{ size: "sm" }} text="Save Configuration" /> : "Save Configuration"}
                </Button>
            </div>

            {/* Add Services to Contract Line */}
            <Card>
                <CardHeader>
                    <CardTitle>Manage Contract Line Services</CardTitle>
                </CardHeader>
                <CardContent>
                    <GenericPlanServicesList contractLineId={contractLineId} onServicesChanged={handleServicesChanged} disableEditing={true} />
                </CardContent>
            </Card>
        </div>
    </Tooltip.Provider>
  );
}
