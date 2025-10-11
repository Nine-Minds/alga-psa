// server/src/components/billing-dashboard/BillingPlanDialog.tsx
'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { SwitchWithLabel } from '../ui/SwitchWithLabel';
import { Tooltip } from '../ui/Tooltip';
import CustomSelect from '../ui/CustomSelect';
import { createBillingPlan, updateBillingPlan, updateBillingPlanFixedConfig, getBillingPlanFixedConfig } from 'server/src/lib/actions/billingPlanAction';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { useTenant } from '../TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Package, Clock, Droplet, Activity, DollarSign, HelpCircle, Plus, X, TrendingUp } from 'lucide-react';


type PlanType = 'Fixed' | 'Hourly' | 'Bucket' | 'Usage';

interface BillingPlanDialogProps {
  onPlanAdded: (newPlanId?: string) => void;
  editingPlan?: IBillingPlan | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[];
}

export function BillingPlanDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: BillingPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [isCustom, setIsCustom] = useState(false);

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);

  // Hourly plan state
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  // Bucket plan state
  const [bucketHours, setBucketHours] = useState<number | undefined>(undefined);
  const [bucketMonthlyFee, setBucketMonthlyFee] = useState<number | undefined>(undefined);
  const [bucketMonthlyFeeInput, setBucketMonthlyFeeInput] = useState<string>('');
  const [bucketOverageRate, setBucketOverageRate] = useState<number | undefined>(undefined);
  const [bucketOverageRateInput, setBucketOverageRateInput] = useState<string>('');

  // Services state
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [fixedServices, setFixedServices] = useState<Array<{ service_id: string; service_name: string; quantity: number }>>([]);
  const [hourlyServices, setHourlyServices] = useState<Array<{ service_id: string; service_name: string; hourly_rate: number | undefined }>>([]);
  const [hourlyServiceRateInputs, setHourlyServiceRateInputs] = useState<Record<number, string>>({});
  const [bucketServices, setBucketServices] = useState<Array<{ service_id: string; service_name: string }>>([]);
  const [usageServices, setUsageServices] = useState<Array<{ service_id: string; service_name: string; unit_rate: number | undefined; unit_of_measure: string }>>([]);
  const [usageServiceRateInputs, setUsageServiceRateInputs] = useState<Record<number, string>>({});

  const tenant = useTenant()!;
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Load services
  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const result = await getServices();
      if (result && Array.isArray(result.services)) {
        setServices(result.services);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setIsLoadingServices(false);
    }
  };

  // Load config when editing
  useEffect(() => {
    const loadFixedConfig = async (planId: string) => {
      try {
        const config = await getBillingPlanFixedConfig(planId);
        if (config?.base_rate) {
          setBaseRate(config.base_rate);
          setBaseRateInput((config.base_rate / 100).toFixed(2));
        }
        setEnableProration(config?.enable_proration ?? false);
      } catch (err) {
        console.error('Error loading plan config:', err);
      }
    };

    if (open) {
      if (editingPlan) {
        setPlanName(editingPlan.plan_name);
        const type = editingPlan.plan_type as PlanType;
        setPlanType(type);
        setIsCustom(editingPlan.is_custom);
        if (editingPlan.plan_id && type === 'Fixed') {
          loadFixedConfig(editingPlan.plan_id);
        }
      } else {
        resetForm();
      }
    }
  }, [editingPlan, open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract Line Name is required');
    if (!planType) errors.push('Contract Line Type is required');

    if (planType === 'Fixed') {
      if (fixedServices.length === 0) {
        errors.push('At least one fixed service is required');
      }
      if (baseRate === undefined || baseRate === null || isNaN(baseRate) || baseRate === 0) {
        errors.push('Base Rate is required for Fixed Fee plans');
      }
      // Check that all services are selected
      fixedServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(`Service ${index + 1}: Please select a service`);
        }
      });
    } else if (planType === 'Hourly') {
      if (hourlyServices.length === 0) {
        errors.push('At least one hourly service is required');
      }
      // Check that all services have rates
      hourlyServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(`Service ${index + 1}: Please select a service`);
        }
        if (!service.hourly_rate || service.hourly_rate === 0) {
          errors.push(`Service ${index + 1}: Hourly rate is required`);
        }
      });
    } else if (planType === 'Bucket') {
      if (!bucketHours) errors.push('Bucket Hours are required');
      if (!bucketMonthlyFee) errors.push('Monthly Fee is required for Bucket plans');
      if (!bucketOverageRate) errors.push('Overage Rate is required for Bucket plans');
      // Services are optional for bucket plans
    } else if (planType === 'Usage') {
      if (usageServices.length === 0) {
        errors.push('At least one usage-based service is required');
      }
      // Check that all services have rates and units
      usageServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(`Service ${index + 1}: Please select a service`);
        }
        if (!service.unit_rate || service.unit_rate === 0) {
          errors.push(`Service ${index + 1}: Unit rate is required`);
        }
        if (!service.unit_of_measure?.trim()) {
          errors.push(`Service ${index + 1}: Unit of measure is required`);
        }
      });
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    await savePlan();
  };

  const savePlan = async () => {
    setIsSaving(true);
    setValidationErrors([]);

    try {
      const planData: Partial<IBillingPlan> = {
        plan_name: planName,
        billing_frequency: 'monthly', // Default to monthly - actual frequency is set at contract level
        is_custom: isCustom,
        plan_type: planType!,
        tenant: tenant
      };

      let savedPlanId: string | undefined;

      if (editingPlan?.plan_id) {
        const { plan_id, ...updateData } = planData;
        const updatedPlan = await updateBillingPlan(editingPlan.plan_id, updateData);
        savedPlanId = updatedPlan.plan_id;
      } else {
        const { plan_id, ...createData } = planData;
        const newPlan = await createBillingPlan(createData as Omit<IBillingPlan, 'plan_id'>);
        savedPlanId = newPlan.plan_id;
      }

      // Save plan-type-specific config
      if (savedPlanId) {
        if (planType === 'Fixed') {
          await updateBillingPlanFixedConfig(savedPlanId, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: 'start'
          });
          // TODO: Save fixed services
          console.log('Fixed services to save:', {
            plan_id: savedPlanId,
            services: fixedServices
          });
          // for (const service of fixedServices) {
          //   await upsertPlanServiceFixedConfiguration({
          //     plan_id: savedPlanId,
          //     service_id: service.service_id,
          //     quantity: service.quantity
          //   });
          // }
        } else if (planType === 'Hourly') {
          // TODO: Save hourly services configurations
          // Need to call upsertPlanServiceHourlyConfiguration for each service
          console.log('Hourly services to save:', {
            plan_id: savedPlanId,
            minimum_billable_time: minimumBillableTime,
            round_up_to_nearest: roundUpToNearest,
            services: hourlyServices
          });
          // for (const service of hourlyServices) {
          //   await upsertPlanServiceHourlyConfiguration({
          //     plan_id: savedPlanId,
          //     service_id: service.service_id,
          //     hourly_rate: service.hourly_rate,
          //     minimum_billable_time: minimumBillableTime,
          //     round_up_to_nearest: roundUpToNearest
          //   });
          // }
        } else if (planType === 'Bucket') {
          // TODO: Save bucket configuration
          // Need to call upsertPlanServiceBucketConfigurationAction
          console.log('Bucket configuration to save:', {
            plan_id: savedPlanId,
            total_hours: bucketHours,
            monthly_fee: bucketMonthlyFee,
            overage_rate: bucketOverageRate,
            services: bucketServices
          });
          // for (const service of bucketServices) {
          //   await upsertPlanServiceBucketConfigurationAction({
          //     plan_id: savedPlanId,
          //     service_id: service.service_id,
          //     total_hours: bucketHours,
          //     monthly_fee: bucketMonthlyFee,
          //     overage_rate: bucketOverageRate
          //   });
          // }
        } else if (planType === 'Usage') {
          // TODO: Save usage services configurations
          // Need to call upsertPlanServiceConfiguration for each service
          console.log('Usage services to save:', {
            plan_id: savedPlanId,
            services: usageServices
          });
          // for (const service of usageServices) {
          //   await upsertPlanServiceConfiguration({
          //     plan_id: savedPlanId,
          //     service_id: service.service_id,
          //     unit_rate: service.unit_rate,
          //     unit_of_measure: service.unit_of_measure
          //   });
          // }
        }
      }

      resetForm();
      setOpen(false);
      onPlanAdded(savedPlanId);
    } catch (error) {
      console.error('Error saving billing plan:', error);
      setValidationErrors([`Failed to save contract line: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setPlanType(null);
    setIsCustom(false);
    setBaseRate(undefined);
    setBaseRateInput('');
    setEnableProration(false);
    setMinimumBillableTime(undefined);
    setRoundUpToNearest(undefined);
    setBucketHours(undefined);
    setBucketMonthlyFee(undefined);
    setBucketMonthlyFeeInput('');
    setBucketOverageRate(undefined);
    setBucketOverageRateInput('');
    setFixedServices([]);
    setHourlyServices([]);
    setHourlyServiceRateInputs({});
    setBucketServices([]);
    setUsageServices([]);
    setUsageServiceRateInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
  };

  const serviceOptions = services.map(service => ({
    value: service.service_id,
    label: service.service_name
  }));

  const handleClose = () => {
    if (!editingPlan) {
      resetForm();
    }
    setOpen(false);
    if (onClose) onClose();
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const calculateEffectiveRate = () => {
    if (!bucketHours || !bucketMonthlyFee) return 0;
    return bucketMonthlyFee / bucketHours;
  };

  const renderTypeSelector = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <button
        type="button"
        onClick={() => { setPlanType('Fixed'); clearErrorIfSubmitted(); }}
        className={`text-left p-4 border-2 rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          planType === 'Fixed' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <Package className="h-8 w-8 text-blue-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Fixed Fee Services</h3>
            <p className="text-sm text-gray-600">Set up services that are billed at a fixed monthly rate, regardless of usage.</p>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => { setPlanType('Hourly'); clearErrorIfSubmitted(); }}
        className={`text-left p-4 border-2 rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          planType === 'Hourly' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <Clock className="h-8 w-8 text-green-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Hourly Services</h3>
            <p className="text-sm text-gray-600">Configure services that are billed based on time tracked (T&M work).</p>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => { setPlanType('Bucket'); clearErrorIfSubmitted(); }}
        className={`text-left p-4 border-2 rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          planType === 'Bucket' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <Droplet className="h-8 w-8 text-purple-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Bucket Hours</h3>
            <p className="text-sm text-gray-600">Set up a pre-paid hours pool with overage billing (block hours).</p>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => { setPlanType('Usage'); clearErrorIfSubmitted(); }}
        className={`text-left p-4 border-2 rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          planType === 'Usage' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <Activity className="h-8 w-8 text-orange-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Usage-Based Services</h3>
            <p className="text-sm text-gray-600">Configure services that are billed based on usage or consumption.</p>
          </div>
        </div>
      </button>
    </div>
  );

  const renderFixedConfig = () => {
    const handleAddFixedService = () => {
      setFixedServices([...fixedServices, { service_id: '', service_name: '', quantity: 1 }]);
    };

    const handleRemoveFixedService = (index: number) => {
      const newServices = fixedServices.filter((_, i) => i !== index);
      setFixedServices(newServices);
    };

    const handleFixedServiceChange = (index: number, serviceId: string) => {
      const service = services.find(s => s.service_id === serviceId);
      const newServices = [...fixedServices];
      newServices[index] = {
        ...newServices[index],
        service_id: serviceId,
        service_name: service?.service_name || ''
      };
      setFixedServices(newServices);
    };

    const handleQuantityChange = (index: number, quantity: number) => {
      const newServices = [...fixedServices];
      newServices[index] = { ...newServices[index], quantity };
      setFixedServices(newServices);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>What are Fixed Fee Services?</strong> These services have a set monthly price. You'll still track time entries
            for these services, but billing is based on the fixed rate, not hours worked.
          </p>
        </div>

        {/* Services List */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Services
          </Label>

          {fixedServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`fixed-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    value={service.service_id}
                    onValueChange={(value: string) => handleFixedServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    Quantity
                  </Label>
                  <Input
                    id={`quantity-${index}`}
                    type="number"
                    value={service.quantity}
                    onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                    min="1"
                    className="w-24"
                  />
                </div>
              </div>

              <Button
                id={`remove-fixed-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveFixedService(index)}
                className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-fixed-service"
            type="button"
            variant="outline"
            onClick={handleAddFixedService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Service
          </Button>
        </div>

        {/* Skip hint */}
        {fixedServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No fixed fee services added yet. Click "Add Service" above to get started.
            </p>
          </div>
        )}

        {/* Monthly Base Rate - only show if services added */}
        {fixedServices.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="base-rate" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Monthly Base Rate *
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <Input
                id="base-rate"
                type="text"
                inputMode="decimal"
                value={baseRateInput}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  const decimalCount = (value.match(/\./g) || []).length;
                  if (decimalCount <= 1) {
                    setBaseRateInput(value);
                  }
                }}
                onBlur={() => {
                  if (baseRateInput.trim() === '' || baseRateInput === '.') {
                    setBaseRateInput('');
                    setBaseRate(undefined);
                  } else {
                    const dollars = parseFloat(baseRateInput) || 0;
                    const cents = Math.round(dollars * 100);
                    setBaseRate(cents);
                    setBaseRateInput((cents / 100).toFixed(2));
                  }
                }}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
            <p className="text-xs text-gray-500">The total monthly fee for all fixed services combined</p>
          </div>
        )}

        {/* Proration Toggle - only show if services added */}
        {fixedServices.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SwitchWithLabel
                label="Enable Proration"
                checked={enableProration}
                onCheckedChange={(checked) => setEnableProration(checked)}
              />
              <Tooltip content="Proration automatically adjusts the monthly fee for partial months. For example, if a contract starts mid-month, the client is only charged for the days active that month.">
                <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
              </Tooltip>
            </div>
            <p className="text-xs text-gray-500">
              When enabled, the monthly fee will be prorated for partial months based on the start/end date
            </p>
          </div>
        )}

        {/* Summary */}
        {fixedServices.length > 0 && baseRate && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Fixed Fee Summary</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Services:</strong> {fixedServices.length}</p>
              <p><strong>Monthly Rate:</strong> {formatCurrency(baseRate)}</p>
              <p><strong>Proration:</strong> {enableProration ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderHourlyConfig = () => {
    const handleAddHourlyService = () => {
      setHourlyServices([...hourlyServices, { service_id: '', service_name: '', hourly_rate: undefined }]);
    };

    const handleRemoveHourlyService = (index: number) => {
      const newServices = hourlyServices.filter((_, i) => i !== index);
      setHourlyServices(newServices);
      const newInputs = { ...hourlyServiceRateInputs };
      delete newInputs[index];
      setHourlyServiceRateInputs(newInputs);
    };

    const handleHourlyServiceChange = (index: number, serviceId: string) => {
      const service = services.find(s => s.service_id === serviceId);
      const newServices = [...hourlyServices];
      newServices[index] = {
        ...newServices[index],
        service_id: serviceId,
        service_name: service?.service_name || '',
        hourly_rate: service?.default_rate || undefined
      };
      setHourlyServices(newServices);

      if (service?.default_rate) {
        setHourlyServiceRateInputs(prev => ({ ...prev, [index]: (service.default_rate! / 100).toFixed(2) }));
      }
    };

    const handleHourlyRateChange = (index: number, rate: number) => {
      const newServices = [...hourlyServices];
      newServices[index] = { ...newServices[index], hourly_rate: rate };
      setHourlyServices(newServices);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>What are Hourly Services?</strong> These services are billed based on actual time tracked.
            Each time entry will be multiplied by the hourly rate to calculate the invoice amount.
          </p>
        </div>

        {/* Minimum Billable Time - only show if services added */}
        {hourlyServices.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="minimum-billable-time" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Minimum Billable Time (minutes)
            </Label>
            <Input
              id="minimum-billable-time"
              type="number"
              value={minimumBillableTime || ''}
              onChange={(e) => setMinimumBillableTime(parseInt(e.target.value) || undefined)}
              placeholder="15"
              min="0"
              step="15"
              className="w-32"
            />
            <p className="text-xs text-gray-500">e.g., 15 minutes - any time entry less than this will be rounded up</p>
          </div>
        )}

        {/* Round Up Settings - only show if services added */}
        {hourlyServices.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="round-up-to-nearest" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Round Up To Nearest (minutes)
            </Label>
            <Input
              id="round-up-to-nearest"
              type="number"
              value={roundUpToNearest || ''}
              onChange={(e) => setRoundUpToNearest(parseInt(e.target.value) || undefined)}
              placeholder="15"
              min="0"
              step="15"
              className="w-32"
            />
            <p className="text-xs text-gray-500">e.g., 15 minutes - time entries will be rounded up to the nearest interval</p>
          </div>
        )}

        {/* Services List */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Hourly Services
          </Label>

          {hourlyServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    value={service.service_id}
                    onValueChange={(value: string) => handleHourlyServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                    <DollarSign className="h-3 w-3" />
                    Hourly Rate
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id={`hourly-rate-${index}`}
                      type="text"
                      inputMode="decimal"
                      value={hourlyServiceRateInputs[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        const decimalCount = (value.match(/\./g) || []).length;
                        if (decimalCount <= 1) {
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: value }));
                        }
                      }}
                      onBlur={() => {
                        const inputValue = hourlyServiceRateInputs[index] || '';
                        if (inputValue.trim() === '' || inputValue === '.') {
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: '' }));
                          handleHourlyRateChange(index, 0);
                        } else {
                          const dollars = parseFloat(inputValue) || 0;
                          const cents = Math.round(dollars * 100);
                          handleHourlyRateChange(index, cents);
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                        }
                      }}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {service.hourly_rate ? `${formatCurrency(service.hourly_rate)}/hour` : 'Enter hourly rate'}
                  </p>
                </div>
              </div>

              <Button
                id={`remove-hourly-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveHourlyService(index)}
                className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-hourly-service"
            type="button"
            variant="outline"
            onClick={handleAddHourlyService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Hourly Service
          </Button>
        </div>

        {/* Skip hint */}
        {hourlyServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No hourly services added yet. Click "Add Hourly Service" above to get started.
            </p>
          </div>
        )}

        {/* Summary */}
        {hourlyServices.length > 0 && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Hourly Services Summary</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Services:</strong> {hourlyServices.length}</p>
              {minimumBillableTime && (
                <p><strong>Minimum Time:</strong> {minimumBillableTime} minutes</p>
              )}
              {roundUpToNearest && (
                <p><strong>Round Up:</strong> Every {roundUpToNearest} minutes</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBucketConfig = () => {
    const effectiveRate = calculateEffectiveRate();

    const handleAddBucketService = () => {
      setBucketServices([...bucketServices, { service_id: '', service_name: '' }]);
    };

    const handleRemoveBucketService = (index: number) => {
      const newServices = bucketServices.filter((_, i) => i !== index);
      setBucketServices(newServices);
    };

    const handleBucketServiceChange = (index: number, serviceId: string) => {
      const service = services.find(s => s.service_id === serviceId);
      const newServices = [...bucketServices];
      newServices[index] = {
        service_id: serviceId,
        service_name: service?.service_name || ''
      };
      setBucketServices(newServices);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md space-y-2">
          <p className="text-sm text-amber-800">
            <strong>How Bucket Hours Work:</strong>
          </p>
          <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 ml-2">
            <li>Client pays a fixed monthly fee for a certain number of hours</li>
            <li>Hours are "filled into the bucket" as time is tracked</li>
            <li>Once the bucket is full, additional hours are billed at the overage rate</li>
            <li>Great for clients who want predictable monthly costs with flexibility</li>
          </ul>
          <div className="mt-3 p-3 bg-amber-100 rounded text-xs text-amber-900">
            <strong>Example:</strong> 40 hours/month @ $5,000 = $125/hour effective rate.<br/>
            If they use 45 hours, they pay $5,000 + (5 hours × $150 overage rate) = $5,750
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="bucket-hours" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Hours Per Period (Month) *
            </Label>
            <Tooltip content="The number of hours included in the monthly fee. Once these hours are used, any additional time is billed at the overage rate.">
              <HelpCircle className="h-4 w-4 text-gray-400 cursor-help" />
            </Tooltip>
          </div>
          <Input
            id="bucket-hours"
            type="number"
            value={bucketHours || ''}
            onChange={(e) => setBucketHours(parseInt(e.target.value) || undefined)}
            placeholder="40"
            min="1"
            step="1"
            className="w-32"
          />
          <p className="text-xs text-gray-500">How many hours are included in the monthly bucket?</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bucket-monthly-fee" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Monthly Fee *
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="bucket-monthly-fee"
              type="text"
              inputMode="decimal"
              value={bucketMonthlyFeeInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                const decimalCount = (value.match(/\./g) || []).length;
                if (decimalCount <= 1) {
                  setBucketMonthlyFeeInput(value);
                }
              }}
              onBlur={() => {
                if (bucketMonthlyFeeInput.trim() === '' || bucketMonthlyFeeInput === '.') {
                  setBucketMonthlyFeeInput('');
                  setBucketMonthlyFee(undefined);
                } else {
                  const dollars = parseFloat(bucketMonthlyFeeInput) || 0;
                  const cents = Math.round(dollars * 100);
                  setBucketMonthlyFee(cents);
                  setBucketMonthlyFeeInput((cents / 100).toFixed(2));
                }
              }}
              placeholder="0.00"
              className="pl-7 w-48"
            />
          </div>
          <p className="text-xs text-gray-500">Fixed monthly price for the bucket hours</p>
        </div>

        {bucketHours && bucketMonthlyFee && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-800">
              <strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/hour
              <span className="text-xs ml-2">({formatCurrency(bucketMonthlyFee)} ÷ {bucketHours} hours)</span>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="bucket-overage-rate" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Overage Rate (per hour) *
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              id="bucket-overage-rate"
              type="text"
              inputMode="decimal"
              value={bucketOverageRateInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                const decimalCount = (value.match(/\./g) || []).length;
                if (decimalCount <= 1) {
                  setBucketOverageRateInput(value);
                }
              }}
              onBlur={() => {
                if (bucketOverageRateInput.trim() === '' || bucketOverageRateInput === '.') {
                  setBucketOverageRateInput('');
                  setBucketOverageRate(undefined);
                } else {
                  const dollars = parseFloat(bucketOverageRateInput) || 0;
                  const cents = Math.round(dollars * 100);
                  setBucketOverageRate(cents);
                  setBucketOverageRateInput((cents / 100).toFixed(2));
                }
              }}
              placeholder="0.00"
              className="pl-7 w-48"
            />
          </div>
          <p className="text-xs text-gray-500">Hourly rate for hours exceeding the bucket</p>
        </div>

        {/* Services Included in Bucket */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Droplet className="h-4 w-4" />
            Services Included in Bucket
          </Label>
          <p className="text-xs text-gray-600 -mt-2">
            Select which services count toward bucket hour usage
          </p>

          {bucketServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
              <div className="flex-1">
                <Label htmlFor={`bucket-service-${index}`} className="text-sm mb-2">
                  Service {index + 1}
                </Label>
                <CustomSelect
                  value={service.service_id}
                  onValueChange={(value: string) => handleBucketServiceChange(index, value)}
                  options={serviceOptions}
                  placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                  disabled={isLoadingServices}
                  className="w-full"
                />
              </div>

              <Button
                id={`remove-bucket-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveBucketService(index)}
                className="mt-6 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-bucket-service"
            type="button"
            variant="outline"
            onClick={handleAddBucketService}
            className="w-full"
            disabled={!bucketHours || !bucketMonthlyFee || !bucketOverageRate}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Service to Bucket
          </Button>
        </div>

        {/* Summary */}
        {bucketHours && bucketMonthlyFee && bucketOverageRate && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Bucket Hours Summary</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Hours/Month:</strong> {bucketHours} hours</p>
              <p><strong>Monthly Fee:</strong> {formatCurrency(bucketMonthlyFee)}</p>
              <p><strong>Effective Rate:</strong> {formatCurrency(Math.round(effectiveRate))}/hour</p>
              <p><strong>Overage Rate:</strong> {formatCurrency(bucketOverageRate)}/hour</p>
              <p><strong>Services:</strong> {bucketServices.length}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderUsageConfig = () => {
    const handleAddUsageService = () => {
      setUsageServices([...usageServices, { service_id: '', service_name: '', unit_rate: undefined, unit_of_measure: 'unit' }]);
    };

    const handleRemoveUsageService = (index: number) => {
      const newServices = usageServices.filter((_, i) => i !== index);
      setUsageServices(newServices);
      const newInputs = { ...usageServiceRateInputs };
      delete newInputs[index];
      setUsageServiceRateInputs(newInputs);
    };

    const handleUsageServiceChange = (index: number, serviceId: string) => {
      const service = services.find(s => s.service_id === serviceId);
      const newServices = [...usageServices];
      newServices[index] = {
        ...newServices[index],
        service_id: serviceId,
        service_name: service?.service_name || '',
        unit_rate: service?.default_rate || undefined,
        unit_of_measure: service?.unit_of_measure || 'unit'
      };
      setUsageServices(newServices);

      if (service?.default_rate) {
        setUsageServiceRateInputs(prev => ({ ...prev, [index]: (service.default_rate! / 100).toFixed(2) }));
      }
    };

    const handleUsageRateChange = (index: number, rate: number) => {
      const newServices = [...usageServices];
      newServices[index] = { ...newServices[index], unit_rate: rate };
      setUsageServices(newServices);
    };

    const handleUnitChange = (index: number, unit: string) => {
      const newServices = [...usageServices];
      newServices[index] = { ...newServices[index], unit_of_measure: unit };
      setUsageServices(newServices);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics.
            Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.
          </p>
        </div>

        {/* Services List */}
        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Usage-Based Services
          </Label>

          {usageServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`usage-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    value={service.service_id}
                    onValueChange={(value: string) => handleUsageServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`unit-rate-${index}`} className="text-sm flex items-center gap-2">
                      <DollarSign className="h-3 w-3" />
                      Rate per Unit
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <Input
                        id={`unit-rate-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={usageServiceRateInputs[index] || ''}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          const decimalCount = (value.match(/\./g) || []).length;
                          if (decimalCount <= 1) {
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: value }));
                          }
                        }}
                        onBlur={() => {
                          const inputValue = usageServiceRateInputs[index] || '';
                          if (inputValue.trim() === '' || inputValue === '.') {
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: '' }));
                            handleUsageRateChange(index, 0);
                          } else {
                            const dollars = parseFloat(inputValue) || 0;
                            const cents = Math.round(dollars * 100);
                            handleUsageRateChange(index, cents);
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                          }
                        }}
                        placeholder="0.00"
                        className="pl-7"
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {service.unit_rate ? `${formatCurrency(service.unit_rate)}/${service.unit_of_measure || 'unit'}` : 'Enter unit rate'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`unit-measure-${index}`} className="text-sm">
                      Unit of Measure
                    </Label>
                    <Input
                      id={`unit-measure-${index}`}
                      type="text"
                      value={service.unit_of_measure || 'unit'}
                      onChange={(e) => handleUnitChange(index, e.target.value)}
                      placeholder="e.g., GB, API call, user"
                    />
                    <p className="text-xs text-gray-500">
                      e.g., GB, API call, transaction
                    </p>
                  </div>
                </div>
              </div>

              <Button
                id={`remove-usage-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveUsageService(index)}
                className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-usage-service"
            type="button"
            variant="outline"
            onClick={handleAddUsageService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Usage-Based Service
          </Button>
        </div>

        {/* Skip hint */}
        {usageServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No usage-based services added yet. Click "Add Usage-Based Service" above to get started.
            </p>
          </div>
        )}

        {/* Summary */}
        {usageServices.length > 0 && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Usage-Based Services Summary</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Services:</strong> {usageServices.length}</p>
              <div className="mt-2 space-y-1">
                {usageServices.map((service, idx) => (
                  service.unit_rate && (
                    <p key={idx} className="text-xs">
                      • {service.service_name || `Service ${idx + 1}`}: {formatCurrency(service.unit_rate)}/{service.unit_of_measure || 'unit'}
                    </p>
                  )
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {triggerButton && (
        <div onClick={() => setOpen(true)}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open}
        onClose={handleClose}
        title={editingPlan ? 'Edit Contract Line' : 'Add New Contract Line'}
        className="max-w-3xl max-h-[90vh]"
      >
        <DialogContent>
          <form onSubmit={handleSubmit} noValidate>
            <div className="space-y-6">
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p className="font-medium mb-2">Please correct the following errors:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {validationErrors.map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Basic Info Section */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Contract Line Information</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Start by entering the basic information for this contract line.
                  </p>
                </div>

                <div>
                  <Label htmlFor="plan-name">Contract Line Name *</Label>
                  <Input
                    id="plan-name"
                    type="text"
                    value={planName}
                    onChange={(e) => {
                      setPlanName(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder="Enter contract line name"
                    required
                    className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Billing frequency is configured when you add this contract line to a contract
                  </p>
                </div>
              </div>

              {/* Type Selection */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Contract Line Type *</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Choose the type of contract line you want to create:
                  </p>
                </div>
                {renderTypeSelector()}
              </div>

              {/* Type-specific configuration */}
              {planType === 'Fixed' && renderFixedConfig()}
              {planType === 'Hourly' && renderHourlyConfig()}
              {planType === 'Bucket' && renderBucketConfig()}
              {planType === 'Usage' && renderUsageConfig()}
            </div>

            <DialogFooter>
              <Button
                id="cancel-billing-plan-button"
                type="button"
                variant="outline"
                onClick={() => {
                  setHasAttemptedSubmit(false);
                  setValidationErrors([]);
                  handleClose();
                }}
                className="bg-white hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button
                id="save-billing-plan-button"
                type="submit"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : (editingPlan ? 'Update Contract Line' : 'Create Contract Line')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
