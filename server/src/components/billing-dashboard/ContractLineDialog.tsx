'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { Switch } from '../ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import {
  createContractLinePreset,
  updateContractLinePreset,
  updateContractLinePresetFixedConfig,
  getContractLinePresetFixedConfig,
  updateContractLinePresetServices,
  getContractLinePresetServices,
} from 'server/src/lib/actions/contractLinePresetActions';
import { IContractLinePreset } from 'server/src/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';
import { Package, Clock, Activity, Plus, X, DollarSign } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { IService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

interface ContractLineDialogProps {
  onPlanAdded: (newPresetId?: string) => void;
  editingPlan?: IContractLinePreset | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[];
}

export function ContractLineDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: ContractLineDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');

  // Services state
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [fixedServices, setFixedServices] = useState<Array<{ service_id: string; service_name: string; quantity: number }>>([]);
  const [hourlyServices, setHourlyServices] = useState<Array<{ service_id: string; service_name: string; hourly_rate: number | undefined }>>([]);
  const [hourlyServiceRateInputs, setHourlyServiceRateInputs] = useState<Record<number, string>>({});
  const [usageServices, setUsageServices] = useState<Array<{ service_id: string; service_name: string; unit_rate: number | undefined; unit_of_measure: string }>>([]);
  const [usageServiceRateInputs, setUsageServiceRateInputs] = useState<Record<number, string>>({});

  // Hourly plan state
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const tenant = useTenant()!;

  const markDirty = () => setIsDirty(true);

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

  // Open dialog when editingPlan is provided
  useEffect(() => {
    if (editingPlan) {
      setOpen(true);
      setPlanName(editingPlan.preset_name);
      setBillingFrequency(editingPlan.billing_frequency);
      setPlanType(editingPlan.contract_line_type as PlanType);
      if (editingPlan.preset_id && editingPlan.contract_line_type === 'Fixed') {
        getContractLinePresetFixedConfig(editingPlan.preset_id)
          .then((cfg) => {
            if (cfg) {
              setBaseRate(cfg.base_rate ?? undefined);
              setEnableProration(!!cfg.enable_proration);
              setBillingCycleAlignment((cfg.billing_cycle_alignment ?? 'start') as any);
            }
          })
          .catch(() => {});
      }
      // Load services for existing preset
      if (editingPlan.preset_id) {
        getContractLinePresetServices(editingPlan.preset_id)
          .then((presetServices) => {
            // Load services based on type
            if (editingPlan.contract_line_type === 'Fixed') {
              const fixedSvcs = presetServices.map(s => ({
                service_id: s.service_id,
                service_name: services.find(svc => svc.service_id === s.service_id)?.service_name || '',
                quantity: s.quantity || 1
              }));
              setFixedServices(fixedSvcs);
            } else if (editingPlan.contract_line_type === 'Hourly') {
              const hourlySvcs = presetServices.map(s => ({
                service_id: s.service_id,
                service_name: services.find(svc => svc.service_id === s.service_id)?.service_name || '',
                hourly_rate: s.custom_rate ? s.custom_rate / 100 : undefined
              }));
              setHourlyServices(hourlySvcs);
            } else if (editingPlan.contract_line_type === 'Usage') {
              const usageSvcs = presetServices.map(s => ({
                service_id: s.service_id,
                service_name: services.find(svc => svc.service_id === s.service_id)?.service_name || '',
                unit_rate: s.custom_rate ? s.custom_rate / 100 : undefined,
                unit_of_measure: s.unit_of_measure || ''
              }));
              setUsageServices(usageSvcs);
            }
          })
          .catch(() => {});
      }
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPlan]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open && !editingPlan) {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract Line Preset Name is required');
    if (!billingFrequency) errors.push('Billing frequency is required');
    if (!planType) errors.push('Contract Line Type is required');

    if (planType === 'Fixed') {
      if (fixedServices.length === 0) {
        errors.push('At least one fixed service is required');
      }
      // Base rate is now optional for presets - it can be set when creating actual contracts
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
      const presetData: Partial<IContractLinePreset> = {
        preset_name: planName,
        billing_frequency: billingFrequency,
        contract_line_type: planType!,
        tenant,
      };

      let savedPresetId: string | undefined;
      if (editingPlan?.preset_id) {
        const { preset_id, ...updateData } = presetData;
        const updatedPreset = await updateContractLinePreset(editingPlan.preset_id, updateData);
        savedPresetId = updatedPreset.preset_id;
      } else {
        const { preset_id, ...createData } = presetData;
        const newPreset = await createContractLinePreset(createData as any);
        savedPresetId = newPreset.preset_id;
      }

      // Save services based on plan type
      if (savedPresetId) {
        const servicesToSave: any[] = [];

        if (planType === 'Fixed') {
          // Save Fixed config
          await updateContractLinePresetFixedConfig(savedPresetId, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: 'start',
          });

          // Save Fixed services
          fixedServices.forEach(service => {
            if (service.service_id) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: service.quantity || 1,
                custom_rate: null,
                unit_of_measure: null
              });
            }
          });
        } else if (planType === 'Hourly') {
          // Save Hourly services
          hourlyServices.forEach(service => {
            if (service.service_id && service.hourly_rate) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: null,
                custom_rate: Math.round(service.hourly_rate * 100), // Convert to cents
                unit_of_measure: null
              });
            }
          });
        } else if (planType === 'Usage') {
          // Save Usage services
          usageServices.forEach(service => {
            if (service.service_id && service.unit_rate) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: null,
                custom_rate: Math.round(service.unit_rate * 100), // Convert to cents
                unit_of_measure: service.unit_of_measure || ''
              });
            }
          });
        }

        // Update services for the preset
        await updateContractLinePresetServices(savedPresetId, servicesToSave);
      }

      resetForm();
      setOpen(false);
      onPlanAdded(savedPresetId);
    } catch (error) {
      console.error('Error saving contract line preset:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract line preset';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setPlanType(null);
    setBillingFrequency('monthly');
    setBaseRate(undefined);
    setBaseRateInput('');
    setEnableProration(false);
    setBillingCycleAlignment('start');
    setMinimumBillableTime(undefined);
    setRoundUpToNearest(undefined);
    setFixedServices([]);
    setHourlyServices([]);
    setHourlyServiceRateInputs({});
    setUsageServices([]);
    setUsageServiceRateInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
    setIsDirty(false);
  };

  const closeDialog = () => {
    setOpen(false);
    resetForm();
    onClose?.();
  };

  const handleCloseRequest = (force = false) => {
    if (!force && isDirty) {
      setOpen(true);
      return;
    }
    closeDialog();
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const renderFixedConfig = () => {
    // Filter to only show services with billing_method === 'fixed'
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
            <strong>What are Fixed Fee Services?</strong> These services have a set monthly price. You'll still track time entries
            for these services, but billing is based on the fixed rate, not hours worked.
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
    // Filter to only show services with billing_method === 'hourly'
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
            <strong>What are Hourly Services?</strong> These services are billed based on actual time tracked.
            Each time entry will be multiplied by the hourly rate to calculate the invoice amount.
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
              <p className="text-xs text-gray-500">e.g., 15 minutes - any time entry less than this will be rounded up</p>
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
              <p className="text-xs text-gray-500">e.g., 15 minutes - time entries will be rounded up to the nearest interval</p>
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
    // Filter to only show services with billing_method === 'usage'
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
            <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics.
            Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.
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
    <>
      {triggerButton && (
        <div
          onClick={() => {
            if (editingPlan) {
              setPlanName(editingPlan.contract_line_name);
              setBillingFrequency(editingPlan.billing_frequency);
              setPlanType(editingPlan.contract_line_type as PlanType);
              setIsCustom(editingPlan.is_custom);
              setIsDirty(false);
            }
            setOpen(true);
          }}
        >
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open}
        onClose={() => handleCloseRequest(false)}
        title={editingPlan ? 'Edit Contract Line Preset' : 'Add Contract Line Preset'}
        className="max-w-3xl"
        hideCloseButton={!!editingPlan}
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
                <h3 className="text-lg font-semibold">Contract Line Preset Basics</h3>
                <p className="text-sm text-gray-600">
                  Create a reusable template that can be quickly added to contracts or contract templates. Define the billing model, services, and default rates that will be copied when this preset is used.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Contract Line Preset Name *</Label>
                  <Input
                    id="name"
                    value={planName}
                    onChange={(e) => {
                      setPlanName(e.target.value);
                      clearErrorIfSubmitted();
                      markDirty();
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
                      markDirty();
                    }}
                    options={BILLING_FREQUENCY_OPTIONS}
                    placeholder="Select billing frequency"
                    className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Choose a Billing Model *</h3>
                <p className="text-sm text-gray-600">
                  Select the billing behavior that fits this offering. Services and overlays can be attached once the line exists.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
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
                      description: 'Bill based on approved time entries and hourly overlays.',
                      icon: Clock,
                      accent: 'text-emerald-600',
                    },
                    {
                      key: 'Usage' as PlanType,
                      title: 'Usage-Based',
                      description: 'Invoice for units consumed such as devices or licenses.',
                      icon: Activity,
                      accent: 'text-orange-600',
                    },
                  ] as const
                ).map(({ key, title, description, icon: Icon, accent }) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      setPlanType(key);
                      clearErrorIfSubmitted();
                      markDirty();
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
                    Set up services that are billed at a fixed monthly rate, regardless of usage.
                  </p>
                </div>
                {renderFixedConfig()}

                {fixedServices.length > 0 && (
                  <>
                    <div className="space-y-2 pt-4 border-t">
                      <Label htmlFor="base-rate">Monthly Base Rate (Optional)</Label>
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
                              markDirty();
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
                      <p className="text-xs text-gray-500">Suggested monthly fee for all fixed services. Can be overridden when adding this preset to a contract.</p>
                    </div>

                    <div className="border border-gray-200 rounded-md p-4 bg-white space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="enable-proration" className="font-medium text-gray-800">
                          Enable Proration
                        </Label>
                        <Switch
                          id="enable-proration"
                          checked={enableProration}
                          onCheckedChange={(checked) => {
                            setEnableProration(checked);
                            markDirty();
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        When enabled, the monthly fee will be prorated for partial months based on the start/end date
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
                    Configure services that are billed based on time tracked. Perfect for T&M (Time & Materials) work.
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
              <Button id="contract-line-cancel" variant="outline" onClick={() => handleCloseRequest(true)}>
                Cancel
              </Button>
              <Button
                id="contract-line-submit"
                type="submit"
                disabled={isSaving}
                className={!planName.trim() || !planType || !billingFrequency ? 'opacity-50' : ''}
              >
                {isSaving ? 'Saving…' : editingPlan ? 'Update Contract Line Preset' : 'Create Contract Line Preset'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
