'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Search, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { IContractLinePreset, IContractLinePresetService, IContractLinePresetFixedConfig } from '@alga-psa/types';
import {
  getContractLinePresets,
  copyPresetToContractLine,
  getContractLinePresetServices,
  getContractLinePresetFixedConfig
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { getServices } from '@alga-psa/billing/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useContractLineTypeOptions,
  useFormatBillingFrequency,
  useFormatContractLineType,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';

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
  const { t } = useTranslation('msp/contracts');
  const contractLineTypeOptions = useContractLineTypeOptions();
  const formatContractLineType = useFormatContractLineType();
  const formatBillingFrequency = useFormatBillingFrequency();
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
        const allServices = await getServices(1, 999, { item_kind: 'any' });
        const serviceMap = new Map(allServices.services.map((s) => [s.service_id, s]));

        // Enhance services with names and default rates
        const enhancedServices: ContractLinePresetServiceWithName[] = services.map(service => {
          const serviceDetails = serviceMap.get(service.service_id);
          return {
            ...service,
            service_name: serviceDetails?.service_name || t('addLines.services.unknownService', {
              defaultValue: 'Unknown Service',
            }),
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
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('addLines.title', { defaultValue: 'Add Contract Lines from Presets' })}
      className="max-w-4xl"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button
            id="cancel-add-contract-lines"
            variant="outline"
            onClick={onClose}
            disabled={isAdding}
          >
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="confirm-add-contract-lines"
            onClick={handleAdd}
            disabled={selectedPresetIds.size === 0 || isAdding}
          >
            {isAdding
              ? t('addLines.actions.adding', { defaultValue: 'Adding...' })
              : selectedPresetIds.size === 1
              ? t('addLines.actions.addSingle', { defaultValue: 'Add ({{count}}) Preset', count: selectedPresetIds.size })
              : t('addLines.actions.addPlural', { defaultValue: 'Add ({{count}}) Presets', count: selectedPresetIds.size })}
          </Button>
        </div>
      )}
    >
      <DialogHeader>
        <DialogTitle>
          {t('addLines.selectPresetsTitle', { defaultValue: 'Select Contract Line Presets to Add' })}
        </DialogTitle>
      </DialogHeader>

      <DialogContent className="flex flex-col">
        <div className="space-y-4 flex flex-col h-full">
          {/* Search and Filter Row - outside overflow container */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="text"
                placeholder={t('addLines.filters.searchPlaceholder', { defaultValue: 'Search presets...' })}
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
                  { value: 'all', label: t('addLines.filters.allTypes', { defaultValue: 'All types' }) },
                  ...contractLineTypeOptions
                ]}
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value)}
                placeholder={t('addLines.filters.typePlaceholder', { defaultValue: 'Select type' })}
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
                <XCircle className="h-4 w-4 mr-1" />
                {t('addLines.filters.reset', { defaultValue: 'Reset' })}
              </Button>
            )}
          </div>

          {/* Contract Line Presets List */}
          <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 max-h-[50vh]">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-4 text-center">
                {t('addLines.loading', { defaultValue: 'Loading contract line presets...' })}
              </div>
            ) : availablePresets.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 text-center">
                {t('addLines.empty.noneAvailable', {
                  defaultValue: 'No contract line presets available.',
                })}
              </div>
            ) : filteredPresets.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 text-center">
                {t('addLines.empty.noMatches', { defaultValue: 'No presets match your search.' })}
              </div>
            ) : (
              filteredPresets.map((preset) => {
                if (!preset.preset_id) return null;
                const isExpanded = expandedPresets[preset.preset_id];
                const services = presetServices[preset.preset_id] || [];
                const serviceCount = presetServiceCounts[preset.preset_id] || 0;
                const fixedConfig = presetFixedConfigs[preset.preset_id];

                return (
                  <div key={preset.preset_id} className="border rounded bg-card shadow-sm">
                    {/* Main row - clickable to expand */}
                    <div
                      className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => preset.preset_id && toggleExpand(preset.preset_id)}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          id={`preset-${preset.preset_id}`}
                          checked={selectedPresetIds.has(preset.preset_id)}
                          onChange={() => preset.preset_id && togglePreset(preset.preset_id)}
                          aria-label={selectedPresetIds.has(preset.preset_id)
                            ? t('addLines.selection.deselectPreset', { defaultValue: 'Deselect preset' })
                            : t('addLines.selection.selectPreset', { defaultValue: 'Select preset' })}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm text-[rgb(var(--color-text-900))]">{preset.preset_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            variant={
                              preset.contract_line_type === 'Fixed'
                                ? 'info'
                                : preset.contract_line_type === 'Hourly'
                                ? 'success'
                                : preset.contract_line_type === 'Usage'
                                ? 'warning'
                                : 'default-muted'
                            }
                          >
                            {formatContractLineType(preset.contract_line_type)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatBillingFrequency(preset.billing_frequency)}
                          </span>
                          {serviceCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              •{' '}
                              {serviceCount === 1
                                ? t('addLines.serviceCountSingle', {
                                  defaultValue: '{{count}} service',
                                  count: serviceCount,
                                })
                                : t('addLines.serviceCountPlural', {
                                  defaultValue: '{{count}} services',
                                  count: serviceCount,
                                })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-muted-foreground">
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-5 py-4 bg-muted border-t space-y-4">
                        {/* Fixed Rate Configuration for Fixed type presets */}
                        {preset.contract_line_type === 'Fixed' && (
                          <div className="bg-card rounded-md p-4 border border-[rgb(var(--color-border-200))]">
                            <div className="flex items-center justify-between mb-3">
                              <Label className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                                {t('addLines.fixedConfig.title', { defaultValue: 'Fixed Rate Configuration' })}
                              </Label>
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm">
                                <span className="font-medium text-[rgb(var(--color-text-700))]">
                                  {t('addLines.fixedConfig.defaultBaseRate', { defaultValue: 'Default Base Rate:' })}
                                </span>
                                <span className="ml-2 text-[rgb(var(--color-text-900))] font-semibold">
                                  {fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined
                                    ? `$${(fixedConfig.base_rate / 100).toFixed(2)}`
                                    : t('addLines.fixedConfig.notSet', { defaultValue: 'Not set' })}
                                </span>
                              </div>
                              <div>
                                <Label htmlFor={`rate-override-${preset.preset_id}`} className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                                  {t('addLines.fixedConfig.overrideBaseRate', { defaultValue: 'Override Base Rate' })}
                                </Label>
                                <div className="relative mt-1.5">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
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
                                    placeholder={fixedConfig?.base_rate
                                      ? t('addLines.fixedConfig.defaultRatePlaceholder', {
                                        defaultValue: 'Default: ${{rate}}',
                                        rate: (fixedConfig.base_rate / 100).toFixed(2),
                                      })
                                      : t('addLines.fixedConfig.enterBaseRate', { defaultValue: 'Enter base rate' })}
                                    className="pl-8 h-9 text-sm"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t('addLines.fixedConfig.leaveBlankDefault', {
                                    defaultValue: 'Leave blank to use the default rate',
                                  })}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Services Configuration */}
                        <div className="bg-card rounded-md p-4 border border-[rgb(var(--color-border-200))]">
                          <Label className="text-sm font-semibold text-[rgb(var(--color-text-900))] mb-3 block">
                            {preset.contract_line_type === 'Fixed'
                              ? t('addLines.services.includedReference', { defaultValue: 'Services Included (Reference)' })
                              : t('addLines.services.configuration', { defaultValue: 'Services Configuration' })}
                          </Label>
                          {services.length === 0 ? (
                            <div className="text-sm text-muted-foreground italic">
                              {t('addLines.services.empty', { defaultValue: 'No services configured for this preset' })}
                            </div>
                          ) : preset.contract_line_type === 'Fixed' ? (
                            /* For Fixed presets, show services as read-only reference */
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground mb-3">
                                {t('addLines.services.fixedReferenceHelp', {
                                  defaultValue: 'These services are included for reference only. The fixed rate above determines the billing amount.',
                                })}
                              </p>
                              {services.map((service) => (
                                <div key={service.service_id} className="bg-muted rounded-md p-2 border border-[rgb(var(--color-border-200))]">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[rgb(var(--color-text-900))]">{service.service_name}</span>
                                    {service.quantity && service.quantity > 1 && (
                                      <span className="text-xs text-muted-foreground">
                                        {t('addLines.services.quantityShort', {
                                          defaultValue: 'Qty: {{quantity}}',
                                          quantity: service.quantity,
                                        })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : preset.contract_line_type === 'Hourly' ? (
                            /* For Hourly presets, show hourly configuration fields */
                            <div className="space-y-4">
                              {/* Hourly Configuration */}
                              <div className="bg-muted rounded-md p-3 border border-[rgb(var(--color-border-200))]">
                                <Label className="text-xs font-semibold text-[rgb(var(--color-text-900))] mb-2 block">
                                  {t('addLines.hourlyConfig.title', { defaultValue: 'Time Billing Configuration' })}
                                </Label>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label htmlFor={`min-billable-${preset.preset_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                      {t('addLines.hourlyConfig.minimumBillableMinutes', { defaultValue: 'Minimum billable minutes' })}
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
                                    <Label htmlFor={`round-up-${preset.preset_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                      {t('addLines.hourlyConfig.roundUpToNearest', { defaultValue: 'Round up to nearest (minutes)' })}
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
                                <Label className="text-xs font-semibold text-[rgb(var(--color-text-900))] mb-2 block">
                                  {t('addLines.hourlyConfig.servicesAndRates', { defaultValue: 'Services & Hourly Rates' })}
                                </Label>
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
                                      <div key={service.service_id} className="bg-muted rounded-md p-3 border border-[rgb(var(--color-border-200))]">
                                        <div className="font-medium text-sm text-[rgb(var(--color-text-900))] mb-2">{service.service_name}</div>
                                        <div>
                                          <Label htmlFor={`hourly-rate-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                            {t('addLines.hourlyConfig.hourlyRate', { defaultValue: 'Hourly Rate' })}
                                          </Label>
                                          <div className="relative mt-1">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
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
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {t('addLines.hourlyConfig.defaultRate', {
                                              defaultValue: 'Default: ${{rate}}',
                                              rate: (service.default_rate! / 100).toFixed(2),
                                            })}
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
                                  <div key={service.service_id} className="bg-muted rounded-md p-3 border border-[rgb(var(--color-border-200))]">
                                    <div className="font-medium text-sm text-[rgb(var(--color-text-900))] mb-2">{service.service_name}</div>
                                    <div className="grid grid-cols-3 gap-3">
                                      <div>
                                        <Label htmlFor={`quantity-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                          {t('addLines.usageConfig.quantity', { defaultValue: 'Quantity' })}
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
                                        <Label htmlFor={`rate-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                          {t('addLines.usageConfig.ratePerUnit', { defaultValue: 'Rate (per unit)' })}
                                        </Label>
                                        <div className="relative mt-1">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
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
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                          {t('addLines.usageConfig.defaultRate', {
                                            defaultValue: 'Default: ${{rate}}',
                                            rate: (service.default_rate! / 100).toFixed(2),
                                          })}
                                        </p>
                                      </div>
                                      <div>
                                        <Label htmlFor={`unit-measure-${preset.preset_id}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                          {t('addLines.usageConfig.unitOfMeasure', { defaultValue: 'Unit of Measure' })}
                                        </Label>
                                        <Input
                                          id={`unit-measure-${preset.preset_id}-${service.service_id}`}
                                          type="text"
                                          value={service.unit_of_measure || t('addLines.usageConfig.unitPlaceholder', { defaultValue: 'unit' })}
                                          disabled
                                          className="h-9 text-sm mt-1 bg-muted"
                                        />
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                          {t('addLines.usageConfig.unitHint', { defaultValue: 'e.g., GB, API call, user' })}
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
              {selectedPresetIds.size === 1
                ? t('addLines.selection.selectedSingle', {
                  defaultValue: '{{count}} preset selected',
                  count: selectedPresetIds.size,
                })
                : t('addLines.selection.selectedPlural', {
                  defaultValue: '{{count}} presets selected',
                  count: selectedPresetIds.size,
                })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
