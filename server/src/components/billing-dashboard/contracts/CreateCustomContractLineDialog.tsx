'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { createCustomContractLine, CreateCustomContractLineInput, CustomContractLineServiceConfig } from 'server/src/lib/actions/contractLinePresetActions';
import { Package, Clock, Activity, Plus, X, Coins } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { BucketOverlayFields } from './BucketOverlayFields';
import { BucketOverlayInput } from './ContractWizard';

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

interface CreateCustomContractLineDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  onCreated: () => Promise<void>;
}

export const CreateCustomContractLineDialog: React.FC<CreateCustomContractLineDialogProps> = ({
  isOpen,
  onClose,
  contractId,
  onCreated,
}) => {
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('advance');

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);

  // Services state
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [fixedServices, setFixedServices] = useState<Array<{ service_id: string; service_name: string; quantity: number }>>([]);
  const [hourlyServices, setHourlyServices] = useState<Array<{
    service_id: string;
    service_name: string;
    hourly_rate: number | undefined;
    bucket_overlay?: BucketOverlayInput | null;
  }>>([]);
  const [hourlyServiceRateInputs, setHourlyServiceRateInputs] = useState<Record<number, string>>({});
  const [usageServices, setUsageServices] = useState<Array<{
    service_id: string;
    service_name: string;
    unit_rate: number | undefined;
    unit_of_measure: string;
    bucket_overlay?: BucketOverlayInput | null;
  }>>([]);
  const [usageServiceRateInputs, setUsageServiceRateInputs] = useState<Record<number, string>>({});

  // Hourly plan state
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load services when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadServices();
    } else {
      resetForm();
    }
  }, [isOpen]);

  const loadServices = async () => {
    setIsLoadingServices(true);
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

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract Line Name is required');
    if (!billingFrequency) errors.push('Billing frequency is required');
    if (!planType) errors.push('Contract Line Type is required');

    if (planType === 'Fixed') {
      if (fixedServices.length === 0) {
        errors.push('At least one fixed service is required');
      }
      fixedServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(`Service ${index + 1}: Please select a service`);
        }
      });
    } else if (planType === 'Hourly') {
      if (hourlyServices.length === 0) {
        errors.push('At least one hourly service is required');
      }
      hourlyServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(`Service ${index + 1}: Please select a service`);
        }
        if (!service.hourly_rate || service.hourly_rate === 0) {
          errors.push(`Service ${index + 1}: Hourly rate is required`);
        }
      });
    } else if (planType === 'Usage') {
      if (usageServices.length === 0) {
        errors.push('At least one usage-based service is required');
      }
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
      // Build services array based on plan type
      const serviceConfigs: CustomContractLineServiceConfig[] = [];

      if (planType === 'Fixed') {
        fixedServices.forEach(service => {
          if (service.service_id) {
            serviceConfigs.push({
              service_id: service.service_id,
              quantity: service.quantity || 1,
            });
          }
        });
      } else if (planType === 'Hourly') {
        hourlyServices.forEach(service => {
          if (service.service_id && service.hourly_rate) {
            serviceConfigs.push({
              service_id: service.service_id,
              custom_rate: service.hourly_rate,
              bucket_overlay: service.bucket_overlay ? {
                total_minutes: service.bucket_overlay.total_minutes ?? 0,
                overage_rate: service.bucket_overlay.overage_rate ?? 0,
                allow_rollover: service.bucket_overlay.allow_rollover ?? false,
                billing_period: (service.bucket_overlay.billing_period || billingFrequency) as 'weekly' | 'monthly'
              } : null,
            });
          }
        });
      } else if (planType === 'Usage') {
        usageServices.forEach(service => {
          if (service.service_id && service.unit_rate) {
            serviceConfigs.push({
              service_id: service.service_id,
              custom_rate: service.unit_rate,
              unit_of_measure: service.unit_of_measure || 'unit',
              bucket_overlay: service.bucket_overlay ? {
                total_minutes: service.bucket_overlay.total_minutes ?? 0,
                overage_rate: service.bucket_overlay.overage_rate ?? 0,
                allow_rollover: service.bucket_overlay.allow_rollover ?? false,
                billing_period: (service.bucket_overlay.billing_period || billingFrequency) as 'weekly' | 'monthly'
              } : null,
            });
          }
        });
      }

      const input: CreateCustomContractLineInput = {
        contract_line_name: planName,
        contract_line_type: planType!,
        billing_frequency: billingFrequency,
        billing_timing: billingTiming,
        services: serviceConfigs,
        ...(planType === 'Fixed' ? {
          base_rate: baseRate ?? null,
          enable_proration: enableProration,
        } : {}),
        ...(planType === 'Hourly' ? {
          minimum_billable_time: minimumBillableTime ?? 15,
          round_up_to_nearest: roundUpToNearest ?? 15,
        } : {}),
      };

      await createCustomContractLine(contractId, input);
      await onCreated();
      onClose();
    } catch (error) {
      console.error('Error creating contract line:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create contract line';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setPlanType(null);
    setBillingFrequency('monthly');
    setBillingTiming('advance');
    setBaseRate(undefined);
    setBaseRateInput('');
    setEnableProration(false);
    setMinimumBillableTime(undefined);
    setRoundUpToNearest(undefined);
    setFixedServices([]);
    setHourlyServices([]);
    setHourlyServiceRateInputs({});
    setUsageServices([]);
    setUsageServiceRateInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const renderFixedConfig = () => {
    const fixedServiceOptions = services
      .filter(service => service.billing_method === 'fixed')
      .map(service => ({
        value: service.service_id,
        label: service.service_name
      }));

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
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>Fixed Fee Services:</strong> The contract line's base rate (set below) is the billed amount.
            Service quantity is used for <em>tax allocation</em> — it determines how the fixed fee is proportionally
            attributed across services for tax calculations.
          </p>
        </div>

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
                    options={fixedServiceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    Quantity (for tax allocation)
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
            id="add-fixed-service-button"
            type="button"
            variant="outline"
            onClick={handleAddFixedService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Service
          </Button>
        </div>

        {fixedServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No fixed fee services added yet. Click "Add Service" above to get started.
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderHourlyConfig = () => {
    const hourlyServiceOptions = services
      .filter(service => service.billing_method === 'hourly')
      .map(service => ({
        value: service.service_id,
        label: service.service_name
      }));

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
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>Hourly Services:</strong> These services are billed based on actual time tracked.
          </p>
        </div>

        {hourlyServices.length > 0 && (
          <>
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
            </div>

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
            </div>
          </>
        )}

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
                    options={hourlyServiceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                    <Coins className="h-3 w-3" />
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

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-gray-200">
                  <SwitchWithLabel
                    label="Add bucket of hours"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => {
                      const newServices = [...hourlyServices];
                      if (checked) {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: {
                            total_minutes: undefined,
                            overage_rate: undefined,
                            allow_rollover: false,
                            billing_period: billingFrequency as 'weekly' | 'monthly'
                          }
                        };
                      } else {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: null
                        };
                      }
                      setHourlyServices(newServices);
                    }}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="hours"
                      value={service.bucket_overlay}
                      onChange={(overlay) => {
                        const newServices = [...hourlyServices];
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: overlay
                        };
                        setHourlyServices(newServices);
                      }}
                      automationId={`hourly-bucket-${index}`}
                      billingFrequency={billingFrequency}
                    />
                  )}
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
            id="add-hourly-service-button"
            type="button"
            variant="outline"
            onClick={handleAddHourlyService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Hourly Service
          </Button>
        </div>

        {hourlyServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No hourly services added yet. Click "Add Hourly Service" above to get started.
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderUsageConfig = () => {
    const usageServiceOptions = services
      .filter(service => service.billing_method === 'usage')
      .map(service => ({
        value: service.service_id,
        label: service.service_name
      }));

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
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            <strong>Usage-Based Services:</strong> These services are billed based on actual consumption.
          </p>
        </div>

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
                    options={usageServiceOptions}
                    placeholder={isLoadingServices ? "Loading..." : "Select a service"}
                    disabled={isLoadingServices}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`unit-rate-${index}`} className="text-sm flex items-center gap-2">
                      <Coins className="h-3 w-3" />
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
                        className="pl-10"
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
                  </div>
                </div>

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-gray-200">
                  <SwitchWithLabel
                    label="Add bucket of consumption"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => {
                      const newServices = [...usageServices];
                      if (checked) {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: {
                            total_minutes: undefined,
                            overage_rate: undefined,
                            allow_rollover: false,
                            billing_period: billingFrequency as 'weekly' | 'monthly'
                          }
                        };
                      } else {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: null
                        };
                      }
                      setUsageServices(newServices);
                    }}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="usage"
                      value={service.bucket_overlay}
                      onChange={(overlay) => {
                        const newServices = [...usageServices];
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: overlay
                        };
                        setUsageServices(newServices);
                      }}
                      unitLabel={service.unit_of_measure || 'units'}
                      automationId={`usage-bucket-${index}`}
                      billingFrequency={billingFrequency}
                    />
                  )}
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
            id="add-usage-service-button"
            type="button"
            variant="outline"
            onClick={handleAddUsageService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Usage-Based Service
          </Button>
        </div>

        {usageServices.length === 0 && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-sm text-gray-600 text-center">
              No usage-based services added yet. Click "Add Usage-Based Service" above to get started.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create Custom Contract Line"
      className="max-w-3xl"
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">Please correct the following:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, idx) => (
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
                Create a custom contract line directly for this contract.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">Contract Line Name *</Label>
                <Input
                  id="name"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder="e.g. Managed Support – Gold"
                  required
                  className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                />
              </div>
              <div>
                <Label htmlFor="frequency">Billing Frequency *</Label>
                <CustomSelect
                  id="frequency"
                  value={billingFrequency}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    clearErrorIfSubmitted();
                  }}
                  options={BILLING_FREQUENCY_OPTIONS}
                  placeholder="Select billing frequency"
                  className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
                />
              </div>
              <div>
                <Label htmlFor="billing-timing">Billing Timing</Label>
                <CustomSelect
                  id="billing-timing"
                  value={billingTiming}
                  onValueChange={(value) => setBillingTiming(value as 'arrears' | 'advance')}
                  options={[
                    { value: 'advance', label: 'Advance (bill at start of period)' },
                    { value: 'arrears', label: 'Arrears (bill at end of period)' }
                  ]}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Advance billing is typical for fixed fees; arrears for time/usage-based services.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Choose a Billing Model *</h3>
              <p className="text-sm text-gray-600">
                Select the billing behavior that fits this offering.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {([
                {
                  key: 'Fixed' as PlanType,
                  title: 'Fixed Fee',
                  description: 'Charge a flat amount every billing period.',
                  icon: Package,
                  accent: 'text-blue-600',
                },
                {
                  key: 'Hourly' as PlanType,
                  title: 'Hourly',
                  description: 'Bill based on approved time entries.',
                  icon: Clock,
                  accent: 'text-emerald-600',
                },
                {
                  key: 'Usage' as PlanType,
                  title: 'Usage-Based',
                  description: 'Invoice for units consumed.',
                  icon: Activity,
                  accent: 'text-orange-600',
                },
              ] as const).map(({ key, title, description, icon: Icon, accent }) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    setPlanType(key);
                    clearErrorIfSubmitted();
                  }}
                  className={`text-left p-4 border-2 rounded-lg transition-all focus:outline-none ${
                    planType === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`h-8 w-8 mt-1 flex-shrink-0 ${accent}`} />
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">{title}</h4>
                      <p className="text-sm text-gray-600">{description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {planType === 'Fixed' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Fixed Fee Services</h3>
                <p className="text-sm text-gray-600">
                  Set up services that are billed at a fixed recurring rate.
                </p>
              </div>
              {renderFixedConfig()}

              {fixedServices.length > 0 && (
                <>
                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="base-rate">Recurring Base Rate</Label>
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
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-gray-500">Recurring fee for all fixed services.</p>
                  </div>

                  <div className="border border-gray-200 rounded-md p-4 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enable-proration" className="font-medium text-gray-800">
                        Enable Proration
                      </Label>
                      <Switch
                        id="enable-proration"
                        checked={enableProration}
                        onCheckedChange={setEnableProration}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      When enabled, the recurring fee will be prorated for partial billing periods
                    </p>
                  </div>
                </>
              )}
            </section>
          )}

          {planType === 'Hourly' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Hourly Services</h3>
                <p className="text-sm text-gray-600">
                  Configure services that are billed based on time tracked.
                </p>
              </div>
              {renderHourlyConfig()}
            </section>
          )}

          {planType === 'Usage' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Usage-Based Services</h3>
                <p className="text-sm text-gray-600">
                  Configure services that are billed based on usage or consumption.
                </p>
              </div>
              {renderUsageConfig()}
            </section>
          )}

          <DialogFooter>
            <Button id="custom-contract-line-cancel" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              id="custom-contract-line-submit"
              type="submit"
              disabled={isSaving}
              className={!planName.trim() || !planType || !billingFrequency ? 'opacity-50' : ''}
            >
              {isSaving ? 'Creating...' : 'Create Contract Line'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCustomContractLineDialog;
