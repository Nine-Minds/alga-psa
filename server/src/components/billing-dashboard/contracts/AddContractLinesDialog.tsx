'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Badge } from 'server/src/components/ui/Badge';
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react';
import { IContractLinePreset, IContractLinePresetService, IContractLinePresetFixedConfig } from 'server/src/interfaces/billing.interfaces';
import {
  getContractLinePresets,
  copyPresetToContractLine,
  getContractLinePresetServices,
  getContractLinePresetFixedConfig
} from 'server/src/lib/actions/contractLinePresetActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { CONTRACT_LINE_TYPE_DISPLAY } from 'server/src/constants/billing';

interface ContractLinePresetServiceWithName extends IContractLinePresetService {
  service_name?: string;
  default_rate?: number;
}

interface PresetServiceOverrides {
  quantity?: number;
  custom_rate?: number;
}

interface AddContractLinesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  onAdd: () => Promise<void>;
}

export const AddContractLinesDialog: React.FC<AddContractLinesDialogProps> = ({
  isOpen,
  onClose,
  contractId,
  onAdd,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [expandedPresets, setExpandedPresets] = useState<Record<string, boolean>>({});
  const [presetServices, setPresetServices] = useState<Record<string, ContractLinePresetServiceWithName[]>>({});
  const [presetFixedConfigs, setPresetFixedConfigs] = useState<Record<string, IContractLinePresetFixedConfig | null>>({});
  const [presetServiceCounts, setPresetServiceCounts] = useState<Record<string, number>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [availablePresets, setAvailablePresets] = useState<IContractLinePreset[]>([]);

  // Rate overrides for presets (stores in cents)
  const [presetRateOverrides, setPresetRateOverrides] = useState<Record<string, number | null>>({});
  const [presetRateInputs, setPresetRateInputs] = useState<Record<string, string>>({});

  // Service overrides for each preset
  const [presetServiceOverrides, setPresetServiceOverrides] = useState<Record<string, Record<string, PresetServiceOverrides>>>({});
  const [presetServiceInputs, setPresetServiceInputs] = useState<Record<string, Record<string, { quantity: string; rate: string }>>>({});

  // Hourly preset configuration overrides
  const [hourlyPresetOverrides, setHourlyPresetOverrides] = useState<Record<string, { minimum_billable_time?: number; round_up_to_nearest?: number }>>({});
  const [hourlyPresetInputs, setHourlyPresetInputs] = useState<Record<string, { minimum_billable_time: string; round_up_to_nearest: string }>>({});

  // Load contract line presets when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadContractLinePresets();
    } else {
      // Reset state when dialog closes
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setSelectedPresetIds(new Set());
    setExpandedPresets({});
    setPresetServices({});
    setPresetFixedConfigs({});
    setPresetServiceCounts({});
    setPresetRateOverrides({});
    setPresetRateInputs({});
    setPresetServiceOverrides({});
    setPresetServiceInputs({});
    setHourlyPresetOverrides({});
    setHourlyPresetInputs({});
  };

  const loadContractLinePresets = async () => {
    setIsLoading(true);
    try {
      const presets = await getContractLinePresets();
      setAvailablePresets(presets);

      // Load service counts for each preset
      const counts: Record<string, number> = {};
      await Promise.all(
        presets.map(async (preset) => {
          if (preset.preset_id) {
            try {
              const services = await getContractLinePresetServices(preset.preset_id);
              counts[preset.preset_id] = services.length;
            } catch (error) {
              console.error(`Error loading service count for preset ${preset.preset_id}:`, error);
              counts[preset.preset_id] = 0;
            }
          }
        })
      );
      setPresetServiceCounts(counts);
    } catch (error) {
      console.error('Error loading contract line presets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredPresets = availablePresets.filter((preset) => {
    // Search filter
    const matchesSearch = !searchTerm ||
      preset.preset_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      preset.billing_frequency?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      preset.contract_line_type?.toLowerCase().includes(searchTerm.toLowerCase());

    // Type filter
    const matchesType = typeFilter === 'all' || preset.contract_line_type === typeFilter;

    return matchesSearch && matchesType;
  });

  const togglePreset = (presetId: string) => {
    const newSet = new Set(selectedPresetIds);
    if (newSet.has(presetId)) {
      newSet.delete(presetId);
    } else {
      newSet.add(presetId);

      // Initialize hourly preset configuration when preset is selected
      const preset = availablePresets.find(p => p.preset_id === presetId);
      if (preset && preset.contract_line_type === 'Hourly') {
        // Only initialize if not already set
        if (!hourlyPresetOverrides[presetId]) {
          // Use preset values if they exist, otherwise use default of 15
          const minBillable = preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
            ? preset.minimum_billable_time
            : 15;
          const roundUp = preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
            ? preset.round_up_to_nearest
            : 15;

          setHourlyPresetInputs(prev => ({
            ...prev,
            [presetId]: {
              minimum_billable_time: minBillable.toString(),
              round_up_to_nearest: roundUp.toString()
            }
          }));

          setHourlyPresetOverrides(prev => ({
            ...prev,
            [presetId]: {
              minimum_billable_time: minBillable,
              round_up_to_nearest: roundUp
            }
          }));
        }
      }
    }
    setSelectedPresetIds(newSet);
  };

  const toggleExpand = async (presetId: string) => {
    const isExpanded = expandedPresets[presetId];

    setExpandedPresets(prev => ({
      ...prev,
      [presetId]: !isExpanded
    }));

    // Load services and fixed config if expanding and not already loaded
    if (!isExpanded && !presetServices[presetId]) {
      try {
        // Load services
        const services = await getContractLinePresetServices(presetId);

        // Load all service details to get names and rates
        const allServices = await getServices(1, 999);
        const serviceMap = new Map(allServices.services.map((s) => [s.service_id, s]));

        // Enhance services with names and default rates
        const enhancedServices: ContractLinePresetServiceWithName[] = services.map(service => {
          const serviceDetails = serviceMap.get(service.service_id);
          return {
            ...service,
            service_name: serviceDetails?.service_name || 'Unknown Service',
            default_rate: serviceDetails?.default_rate || 0
          };
        });

        setPresetServices(prev => ({
          ...prev,
          [presetId]: enhancedServices
        }));

        // Initialize service input states with current quantities and rates
        const serviceInputs: Record<string, { quantity: string; rate: string }> = {};
        enhancedServices.forEach(service => {
          const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
            ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
            : null;

          const rateInCents = customRateValue !== null
            ? customRateValue
            : (service.default_rate || 0);

          serviceInputs[service.service_id] = {
            quantity: service.quantity?.toString() || '1',
            rate: (rateInCents / 100).toFixed(2)
          };
        });

        setPresetServiceInputs(prev => ({
          ...prev,
          [presetId]: serviceInputs
        }));

        // Load config for type-specific presets
        const preset = availablePresets.find(p => p.preset_id === presetId);

        if (preset?.contract_line_type === 'Fixed') {
          const fixedConfig = await getContractLinePresetFixedConfig(presetId);
          setPresetFixedConfigs(prev => ({
            ...prev,
            [presetId]: fixedConfig
          }));

          // Initialize preset rate input if it has a base_rate
          if (fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined) {
            setPresetRateInputs(prev => ({
              ...prev,
              [presetId]: (fixedConfig.base_rate! / 100).toFixed(2)
            }));
          }
        } else if (preset?.contract_line_type === 'Hourly') {
          // Initialize hourly preset configuration from preset defaults
          // Use preset values if they exist, otherwise use default of 15
          const minBillable = preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
            ? preset.minimum_billable_time
            : 15;
          const roundUp = preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
            ? preset.round_up_to_nearest
            : 15;

          setHourlyPresetInputs(prev => ({
            ...prev,
            [presetId]: {
              minimum_billable_time: minBillable.toString(),
              round_up_to_nearest: roundUp.toString()
            }
          }));

          setHourlyPresetOverrides(prev => ({
            ...prev,
            [presetId]: {
              minimum_billable_time: minBillable,
              round_up_to_nearest: roundUp
            }
          }));
        }
      } catch (error) {
        console.error(`Error loading services for preset ${presetId}:`, error);
      }
    }
  };

  const handleAdd = async () => {
    if (selectedPresetIds.size === 0) return;

    setIsAdding(true);
    try {
      // Add each selected preset to the contract
      await Promise.all(
        Array.from(selectedPresetIds).map(presetId => {
          const overrides: {
            base_rate?: number | null;
            services?: Record<string, { quantity?: number; custom_rate?: number }>;
            minimum_billable_time?: number;
            round_up_to_nearest?: number;
          } = {};

          // Add base_rate override for Fixed type presets
          if (presetRateOverrides[presetId] !== undefined) {
            overrides.base_rate = presetRateOverrides[presetId];
          }

          // Add hourly configuration overrides
          const hourlyConfig = hourlyPresetOverrides[presetId];
          if (hourlyConfig) {
            if (hourlyConfig.minimum_billable_time !== undefined) {
              overrides.minimum_billable_time = hourlyConfig.minimum_billable_time;
            }
            if (hourlyConfig.round_up_to_nearest !== undefined) {
              overrides.round_up_to_nearest = hourlyConfig.round_up_to_nearest;
            }
          }

          // Add service-level overrides (quantity and custom_rate)
          const serviceOverrides = presetServiceOverrides[presetId];
          if (serviceOverrides && Object.keys(serviceOverrides).length > 0) {
            overrides.services = {};
            for (const [serviceId, override] of Object.entries(serviceOverrides)) {
              overrides.services[serviceId] = {
                quantity: override.quantity,
                custom_rate: override.custom_rate
              };
            }
          }

          return copyPresetToContractLine(contractId, presetId, Object.keys(overrides).length > 0 ? overrides : undefined);
        })
      );

      await onAdd();
      onClose();
    } catch (error) {
      console.error('Error adding contract line presets:', error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Add Contract Lines from Presets" className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>Select Contract Line Presets to Add</DialogTitle>
      </DialogHeader>

      <DialogContent className="max-h-[70vh] overflow-hidden flex flex-col">
        <div className="space-y-4">
          {/* Search and Filter Row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <Input
                type="text"
                placeholder="Search presets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Type Filter */}
            <div className="w-48">
              <CustomSelect
                id="preset-type-filter"
                options={[
                  { value: 'all', label: 'All types' },
                  ...Object.entries(CONTRACT_LINE_TYPE_DISPLAY).map(([value, label]) => ({
                    value,
                    label
                  }))
                ]}
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value)}
                placeholder="Select type"
              />
            </div>

            {/* Clear filters button */}
            {(searchTerm || typeFilter !== 'all') && (
              <Button
                id="clear-contract-line-filters"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setTypeFilter('all');
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Contract Line Presets List */}
          <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 max-h-[50vh]">
            {isLoading ? (
              <div className="text-sm text-gray-500 p-4 text-center">
                Loading contract line presets...
              </div>
            ) : availablePresets.length === 0 ? (
              <div className="text-sm text-gray-500 p-4 text-center">
                No contract line presets available.
              </div>
            ) : filteredPresets.length === 0 ? (
              <div className="text-sm text-gray-500 p-4 text-center">
                No presets match your search.
              </div>
            ) : (
              filteredPresets.map((preset) => {
                if (!preset.preset_id) return null;
                const isExpanded = expandedPresets[preset.preset_id];
                const services = presetServices[preset.preset_id] || [];
                const serviceCount = presetServiceCounts[preset.preset_id] || 0;
                const fixedConfig = presetFixedConfigs[preset.preset_id];

                return (
                  <div key={preset.preset_id} className="border rounded bg-white shadow-sm">
                    {/* Main row - clickable to expand */}
                    <div
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => preset.preset_id && toggleExpand(preset.preset_id)}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          id={`preset-${preset.preset_id}`}
                          checked={selectedPresetIds.has(preset.preset_id)}
                          onChange={() => preset.preset_id && togglePreset(preset.preset_id)}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm text-gray-900">{preset.preset_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            className={
                              preset.contract_line_type === 'Fixed'
                                ? 'bg-green-100 text-green-800 border-green-200'
                                : preset.contract_line_type === 'Hourly'
                                ? 'bg-purple-100 text-purple-800 border-purple-200'
                                : preset.contract_line_type === 'Usage'
                                ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                                : 'bg-gray-100 text-gray-800 border-gray-200'
                            }
                          >
                            {preset.contract_line_type}
                          </Badge>
                          <span className="text-xs text-gray-600">{preset.billing_frequency}</span>
                          {serviceCount > 0 && (
                            <span className="text-xs text-gray-600">• {serviceCount} service{serviceCount !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-gray-600">
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-5 py-4 bg-gray-50 border-t space-y-4">
                        {/* Fixed Rate Configuration for Fixed type presets */}
                        {preset.contract_line_type === 'Fixed' && (
                          <div className="bg-white rounded-md p-4 border border-gray-200">
                            <div className="flex items-center justify-between mb-3">
                              <Label className="text-sm font-semibold text-gray-900">Fixed Rate Configuration</Label>
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm">
                                <span className="font-medium text-gray-700">Default Base Rate:</span>
                                <span className="ml-2 text-gray-900 font-semibold">
                                  {fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined
                                    ? `$${(fixedConfig.base_rate / 100).toFixed(2)}`
                                    : 'Not set'}
                                </span>
                              </div>
                              <div>
                                <Label htmlFor={`rate-override-${preset.preset_id}`} className="text-sm font-medium text-gray-700">
                                  Override Base Rate
                                </Label>
                                <div className="relative mt-1.5">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                  <Input
                                    id={`rate-override-${preset.preset_id}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={presetRateInputs[preset.preset_id] || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.replace(/[^0-9.]/g, '');
                                      const decimalCount = (value.match(/\./g) || []).length;
                                      if (decimalCount <= 1) {
                                        setPresetRateInputs({
                                          ...presetRateInputs,
                                          [preset.preset_id]: value
                                        });
                                      }
                                    }}
                                    onBlur={() => {
                                      const inputValue = presetRateInputs[preset.preset_id] || '';
                                      if (inputValue.trim() === '' || inputValue === '.') {
                                        const newInputs = { ...presetRateInputs };
                                        delete newInputs[preset.preset_id];
                                        setPresetRateInputs(newInputs);

                                        const newOverrides = { ...presetRateOverrides };
                                        delete newOverrides[preset.preset_id];
                                        setPresetRateOverrides(newOverrides);
                                      } else {
                                        const dollars = parseFloat(inputValue) || 0;
                                        const cents = Math.round(dollars * 100);
                                        setPresetRateOverrides({
                                          ...presetRateOverrides,
                                          [preset.preset_id]: cents
                                        });
                                        setPresetRateInputs({
                                          ...presetRateInputs,
                                          [preset.preset_id]: (cents / 100).toFixed(2)
                                        });
                                      }
                                    }}
                                    placeholder={fixedConfig?.base_rate ? `Default: $${(fixedConfig.base_rate / 100).toFixed(2)}` : 'Enter base rate'}
                                    className="pl-8 h-9 text-sm"
                                  />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  Leave blank to use the default rate
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Services Configuration */}
                        <div className="bg-white rounded-md p-4 border border-gray-200">
                          <Label className="text-sm font-semibold text-gray-900 mb-3 block">
                            {preset.contract_line_type === 'Fixed' ? 'Services Included (Reference)' : 'Services Configuration'}
                          </Label>
                          {services.length === 0 ? (
                            <div className="text-sm text-gray-500 italic">No services configured for this preset</div>
                          ) : preset.contract_line_type === 'Fixed' ? (
                            /* For Fixed presets, show services as read-only reference */
                            <div className="space-y-2">
                              <p className="text-xs text-gray-600 mb-3">
                                These services are included for reference only. The fixed rate above determines the billing amount.
                              </p>
                              {services.map((service) => (
                                <div key={service.service_id} className="bg-gray-50 rounded-md p-2 border border-gray-200">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-900">{service.service_name}</span>
                                    {service.quantity && service.quantity > 1 && (
                                      <span className="text-xs text-gray-600">Qty: {service.quantity}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : preset.contract_line_type === 'Hourly' ? (
                            /* For Hourly presets, show hourly configuration fields */
                            <div className="space-y-4">
                              {/* Hourly Configuration */}
                              <div className="bg-gray-50 rounded-md p-3 border border-gray-200">
                                <Label className="text-xs font-semibold text-gray-900 mb-2 block">Time Billing Configuration</Label>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label htmlFor={`min-billable-${preset.preset_id}`} className="text-xs font-medium text-gray-700">
                                      Minimum billable minutes
                                    </Label>
                                    <Input
                                      id={`min-billable-${preset.preset_id}`}
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={hourlyPresetInputs[preset.preset_id]?.minimum_billable_time || '15'}
                                      onChange={(e) => {
                                        setHourlyPresetInputs(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || { minimum_billable_time: '15', round_up_to_nearest: '15' }),
                                            minimum_billable_time: e.target.value
                                          }
                                        }));
                                      }}
                                      onBlur={() => {
                                        const value = Math.max(0, parseInt(hourlyPresetInputs[preset.preset_id]?.minimum_billable_time || '15') || 0);
                                        setHourlyPresetOverrides(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || {}),
                                            minimum_billable_time: value
                                          }
                                        }));
                                        setHourlyPresetInputs(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || { minimum_billable_time: '15', round_up_to_nearest: '15' }),
                                            minimum_billable_time: value.toString()
                                          }
                                        }));
                                      }}
                                      className="h-9 text-sm mt-1"
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`round-up-${preset.preset_id}`} className="text-xs font-medium text-gray-700">
                                      Round up to nearest (minutes)
                                    </Label>
                                    <Input
                                      id={`round-up-${preset.preset_id}`}
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={hourlyPresetInputs[preset.preset_id]?.round_up_to_nearest || '15'}
                                      onChange={(e) => {
                                        setHourlyPresetInputs(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || { minimum_billable_time: '15', round_up_to_nearest: '15' }),
                                            round_up_to_nearest: e.target.value
                                          }
                                        }));
                                      }}
                                      onBlur={() => {
                                        const value = Math.max(0, parseInt(hourlyPresetInputs[preset.preset_id]?.round_up_to_nearest || '15') || 0);
                                        setHourlyPresetOverrides(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || {}),
                                            round_up_to_nearest: value
                                          }
                                        }));
                                        setHourlyPresetInputs(prev => ({
                                          ...prev,
                                          [preset.preset_id]: {
                                            ...(prev[preset.preset_id] || { minimum_billable_time: '15', round_up_to_nearest: '15' }),
                                            round_up_to_nearest: value.toString()
                                          }
                                        }));
                                      }}
                                      className="h-9 text-sm mt-1"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Services with hourly rates */}
                              <div>
                                <Label className="text-xs font-semibold text-gray-900 mb-2 block">Services & Hourly Rates</Label>
                                <div className="space-y-2">
                                  {services.map((service) => {
                                    const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
                                      ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
                                      : null;

                                    const rateInCents = customRateValue !== null
                                      ? customRateValue
                                      : (service.default_rate || 0);

                                    const serviceInputs = presetServiceInputs[preset.preset_id]?.[service.service_id] || {
                                      quantity: service.quantity?.toString() || '1',
                                      rate: (rateInCents / 100).toFixed(2)
                                    };

                                    return (
                                      <div key={service.service_id} className="bg-gray-50 rounded-md p-3 border border-gray-200">
                                        <div className="font-medium text-sm text-gray-900 mb-2">{service.service_name}</div>
                                        <div>
                                          <Label htmlFor={`hourly-rate-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                            Hourly Rate
                                          </Label>
                                          <div className="relative mt-1">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                            <Input
                                              id={`hourly-rate-${preset.preset_id}-${service.service_id}`}
                                              type="text"
                                              inputMode="decimal"
                                              value={serviceInputs.rate}
                                              onChange={(e) => {
                                                const value = e.target.value.replace(/[^0-9.]/g, '');
                                                const decimalCount = (value.match(/\./g) || []).length;
                                                if (decimalCount <= 1) {
                                                  const newInputs = {
                                                    ...presetServiceInputs,
                                                    [preset.preset_id]: {
                                                      ...(presetServiceInputs[preset.preset_id] || {}),
                                                      [service.service_id]: {
                                                        ...serviceInputs,
                                                        rate: value
                                                      }
                                                    }
                                                  };
                                                  setPresetServiceInputs(newInputs);
                                                }
                                              }}
                                              onBlur={() => {
                                                const dollars = parseFloat(serviceInputs.rate) || 0;
                                                const cents = Math.round(dollars * 100);
                                                const newOverrides = {
                                                  ...presetServiceOverrides,
                                                  [preset.preset_id]: {
                                                    ...(presetServiceOverrides[preset.preset_id] || {}),
                                                    [service.service_id]: {
                                                      ...(presetServiceOverrides[preset.preset_id]?.[service.service_id] || {}),
                                                      custom_rate: cents
                                                    }
                                                  }
                                                };
                                                setPresetServiceOverrides(newOverrides);
                                                const newInputs = {
                                                  ...presetServiceInputs,
                                                  [preset.preset_id]: {
                                                    ...(presetServiceInputs[preset.preset_id] || {}),
                                                    [service.service_id]: {
                                                      ...serviceInputs,
                                                      rate: (cents / 100).toFixed(2)
                                                    }
                                                  }
                                                };
                                                setPresetServiceInputs(newInputs);
                                              }}
                                              placeholder={(service.default_rate! / 100).toFixed(2)}
                                              className="pl-8 h-9 text-sm"
                                            />
                                          </div>
                                          <p className="text-xs text-gray-500 mt-0.5">
                                            Default: ${(service.default_rate! / 100).toFixed(2)}
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* For Usage presets, show quantity, rate, and unit of measure */
                            <div className="space-y-3">
                              {services.map((service) => {
                                const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
                                  ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
                                  : null;

                                const rateInCents = customRateValue !== null
                                  ? customRateValue
                                  : (service.default_rate || 0);

                                const serviceInputs = presetServiceInputs[preset.preset_id]?.[service.service_id] || {
                                  quantity: service.quantity?.toString() || '1',
                                  rate: (rateInCents / 100).toFixed(2)
                                };

                                return (
                                  <div key={service.service_id} className="bg-gray-50 rounded-md p-3 border border-gray-200">
                                    <div className="font-medium text-sm text-gray-900 mb-2">{service.service_name}</div>
                                    <div className="grid grid-cols-3 gap-3">
                                      <div>
                                        <Label htmlFor={`quantity-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                          Quantity
                                        </Label>
                                        <Input
                                          id={`quantity-${preset.preset_id}-${service.service_id}`}
                                          type="number"
                                          min="1"
                                          step="1"
                                          value={serviceInputs.quantity}
                                          onChange={(e) => {
                                            const newInputs = {
                                              ...presetServiceInputs,
                                              [preset.preset_id]: {
                                                ...(presetServiceInputs[preset.preset_id] || {}),
                                                [service.service_id]: {
                                                  ...serviceInputs,
                                                  quantity: e.target.value
                                                }
                                              }
                                            };
                                            setPresetServiceInputs(newInputs);
                                          }}
                                          onBlur={() => {
                                            const quantity = parseInt(serviceInputs.quantity) || 1;
                                            const newOverrides = {
                                              ...presetServiceOverrides,
                                              [preset.preset_id]: {
                                                ...(presetServiceOverrides[preset.preset_id] || {}),
                                                [service.service_id]: {
                                                  ...(presetServiceOverrides[preset.preset_id]?.[service.service_id] || {}),
                                                  quantity
                                                }
                                              }
                                            };
                                            setPresetServiceOverrides(newOverrides);
                                          }}
                                          className="h-9 text-sm mt-1"
                                        />
                                      </div>
                                      <div>
                                        <Label htmlFor={`rate-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                          Rate (per unit)
                                        </Label>
                                        <div className="relative mt-1">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                          <Input
                                            id={`rate-${preset.preset_id}-${service.service_id}`}
                                            type="text"
                                            inputMode="decimal"
                                            value={serviceInputs.rate}
                                            onChange={(e) => {
                                              const value = e.target.value.replace(/[^0-9.]/g, '');
                                              const decimalCount = (value.match(/\./g) || []).length;
                                              if (decimalCount <= 1) {
                                                const newInputs = {
                                                  ...presetServiceInputs,
                                                  [preset.preset_id]: {
                                                    ...(presetServiceInputs[preset.preset_id] || {}),
                                                    [service.service_id]: {
                                                      ...serviceInputs,
                                                      rate: value
                                                    }
                                                  }
                                                };
                                                setPresetServiceInputs(newInputs);
                                              }
                                            }}
                                            onBlur={() => {
                                              const dollars = parseFloat(serviceInputs.rate) || 0;
                                              const cents = Math.round(dollars * 100);
                                              const newOverrides = {
                                                ...presetServiceOverrides,
                                                [preset.preset_id]: {
                                                  ...(presetServiceOverrides[preset.preset_id] || {}),
                                                  [service.service_id]: {
                                                    ...(presetServiceOverrides[preset.preset_id]?.[service.service_id] || {}),
                                                    custom_rate: cents
                                                  }
                                                }
                                              };
                                              setPresetServiceOverrides(newOverrides);
                                              const newInputs = {
                                                ...presetServiceInputs,
                                                [preset.preset_id]: {
                                                  ...(presetServiceInputs[preset.preset_id] || {}),
                                                  [service.service_id]: {
                                                    ...serviceInputs,
                                                    rate: (cents / 100).toFixed(2)
                                                  }
                                                }
                                              };
                                              setPresetServiceInputs(newInputs);
                                            }}
                                            placeholder={(service.default_rate! / 100).toFixed(2)}
                                            className="pl-8 h-9 text-sm"
                                          />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                          Default: ${(service.default_rate! / 100).toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <Label htmlFor={`unit-measure-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-gray-700">
                                          Unit of Measure
                                        </Label>
                                        <Input
                                          id={`unit-measure-${preset.preset_id}-${service.service_id}`}
                                          type="text"
                                          value={service.unit_of_measure || 'unit'}
                                          disabled
                                          className="h-9 text-sm mt-1 bg-gray-100"
                                        />
                                        <p className="text-xs text-gray-500 mt-0.5">
                                          e.g., GB, API call, user
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Selected count */}
          {selectedPresetIds.size > 0 && (
            <div className="text-sm text-blue-600 font-medium">
              {selectedPresetIds.size} preset{selectedPresetIds.size > 1 ? 's' : ''} selected
            </div>
          )}
        </div>
      </DialogContent>

      <DialogFooter>
        <Button
          id="cancel-add-contract-lines"
          variant="outline"
          onClick={onClose}
          disabled={isAdding}
        >
          Cancel
        </Button>
        <Button
          id="confirm-add-contract-lines"
          onClick={handleAdd}
          disabled={selectedPresetIds.size === 0 || isAdding}
        >
          {isAdding ? 'Adding...' : `Add ${selectedPresetIds.size > 0 ? `(${selectedPresetIds.size})` : ''} Preset${selectedPresetIds.size !== 1 ? 's' : ''}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
