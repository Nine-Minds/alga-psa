'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  IContractLinePreset,
  IContractLinePresetFixedConfig,
  IContractLinePresetService,
} from '@alga-psa/types';
import {
  getContractLinePresets,
  getContractLinePresetServices,
  getContractLinePresetServiceCounts,
  getContractLinePresetFixedConfig,
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { getServices } from '@alga-psa/billing/actions/serviceActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const DEFAULT_HOURLY_MINUTES = 15;

export interface ContractLinePresetServiceWithName extends IContractLinePresetService {
  service_name?: string;
  default_rate?: number;
}

export interface PresetServiceOverrides {
  custom_rate?: number;
}

export interface ContractLinePresetOverrides {
  base_rate?: number | null;
  services?: Record<string, { custom_rate?: number }>;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
}

export type HourlyPresetField = 'minimum_billable_time' | 'round_up_to_nearest';

export interface UseContractLinePresetSelectionOptions {
  /** Surfaces expected (returned) action errors, e.g. permission failures. */
  onActionError: (message: string) => void;
  /** Surfaces unexpected failures while loading the preset list. */
  onLoadError?: (message: string) => void;
  /** Surfaces unexpected failures while loading one preset's details. */
  onDetailsError?: (message: string) => void;
}

/** Rate shown for a preset service: its custom rate when set, else the catalog default. */
const serviceRateInCents = (service: ContractLinePresetServiceWithName): number => {
  const customRateValue = service.custom_rate !== undefined && service.custom_rate !== null
    ? (typeof service.custom_rate === 'string' ? parseFloat(service.custom_rate) : service.custom_rate)
    : null;

  return customRateValue !== null ? customRateValue : (service.default_rate || 0);
};

const hourlyDefaults = (preset: IContractLinePreset | undefined) => ({
  minimum_billable_time: preset?.minimum_billable_time !== undefined && preset?.minimum_billable_time !== null
    ? preset.minimum_billable_time
    : DEFAULT_HOURLY_MINUTES,
  round_up_to_nearest: preset?.round_up_to_nearest !== undefined && preset?.round_up_to_nearest !== null
    ? preset.round_up_to_nearest
    : DEFAULT_HOURLY_MINUTES,
});

/**
 * One source of truth for picking contract line presets and editing the rates
 * they will be copied with. Both ContractDialog (create contract) and
 * AddContractLinesDialog (add lines to an existing contract) drive the same
 * state here so their preset editors cannot drift apart again.
 */
export function useContractLinePresetSelection({
  onActionError,
  onLoadError,
  onDetailsError,
}: UseContractLinePresetSelectionOptions) {
  const { t } = useTranslation('msp/contracts');

  const [availablePresets, setAvailablePresets] = useState<IContractLinePreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [expandedPresets, setExpandedPresets] = useState<Record<string, boolean>>({});
  const [presetServices, setPresetServices] = useState<Record<string, ContractLinePresetServiceWithName[]>>({});
  const [presetFixedConfigs, setPresetFixedConfigs] = useState<Record<string, IContractLinePresetFixedConfig | null>>({});
  const [presetServiceCounts, setPresetServiceCounts] = useState<Record<string, number>>({});

  // Rate overrides for presets (stores in cents)
  const [presetRateOverrides, setPresetRateOverrides] = useState<Record<string, number | null>>({});
  const [presetRateInputs, setPresetRateInputs] = useState<Record<string, string>>({});

  // Service overrides for each preset
  const [presetServiceOverrides, setPresetServiceOverrides] = useState<Record<string, Record<string, PresetServiceOverrides>>>({});
  const [presetServiceInputs, setPresetServiceInputs] = useState<Record<string, Record<string, { rate: string }>>>({});

  // Hourly preset configuration overrides
  const [hourlyPresetOverrides, setHourlyPresetOverrides] = useState<Record<string, { minimum_billable_time?: number; round_up_to_nearest?: number }>>({});
  const [hourlyPresetInputs, setHourlyPresetInputs] = useState<Record<string, { minimum_billable_time: string; round_up_to_nearest: string }>>({});

  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    try {
      // Service counts for every preset arrive in one round trip, alongside the
      // presets themselves rather than one fan-out request per preset.
      const [presets, counts] = await Promise.all([
        getContractLinePresets(),
        getContractLinePresetServiceCounts(),
      ]);
      if (isReturnedActionError(presets)) {
        onActionError(getErrorMessage(presets));
        return;
      }
      setAvailablePresets(presets);
      setPresetServiceCounts(isReturnedActionError(counts) ? {} : counts);
    } catch (error) {
      console.error('Error loading contract line presets:', error);
      onLoadError?.(t('addLines.errors.failedToLoadPresets', {
        defaultValue: 'Failed to load contract line presets.',
      }));
    } finally {
      setIsLoading(false);
    }
  }, [onActionError, onLoadError, t]);

  const filteredPresets = useMemo(() => availablePresets.filter((preset) => {
    // Search filter
    const matchesSearch = !searchTerm ||
      preset.preset_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      preset.billing_frequency?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      preset.contract_line_type?.toLowerCase().includes(searchTerm.toLowerCase());

    // Type filter
    const matchesType = typeFilter === 'all' || preset.contract_line_type === typeFilter;

    return matchesSearch && matchesType;
  }), [availablePresets, searchTerm, typeFilter]);

  const resetFilters = useCallback(() => {
    setSearchTerm('');
    setTypeFilter('all');
  }, []);

  const initializeHourlyPreset = useCallback((presetId: string, preset: IContractLinePreset | undefined) => {
    const defaults = hourlyDefaults(preset);

    setHourlyPresetInputs(prev => ({
      ...prev,
      [presetId]: {
        minimum_billable_time: defaults.minimum_billable_time.toString(),
        round_up_to_nearest: defaults.round_up_to_nearest.toString(),
      },
    }));

    setHourlyPresetOverrides(prev => ({
      ...prev,
      [presetId]: defaults,
    }));
  }, []);

  const toggleSelect = useCallback((presetId: string) => {
    const next = new Set(selectedPresetIds);
    if (next.has(presetId)) {
      next.delete(presetId);
    } else {
      next.add(presetId);
    }
    setSelectedPresetIds(next);
  }, [selectedPresetIds]);

  const toggleExpand = useCallback(async (presetId: string) => {
    const isExpanded = expandedPresets[presetId];

    setExpandedPresets(prev => ({
      ...prev,
      [presetId]: !isExpanded,
    }));

    // Load services and type config if expanding and not already loaded
    if (isExpanded || presetServices[presetId]) return;

    try {
      const services = await getContractLinePresetServices(presetId);
      if (isReturnedActionError(services)) {
        onActionError(getErrorMessage(services));
        return;
      }

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
          default_rate: serviceDetails?.default_rate || 0,
        };
      });

      setPresetServices(prev => ({
        ...prev,
        [presetId]: enhancedServices,
      }));

      // Initialize service input states with current rates
      const serviceInputs: Record<string, { rate: string }> = {};
      enhancedServices.forEach(service => {
        serviceInputs[service.service_id] = {
          rate: (serviceRateInCents(service) / 100).toFixed(2),
        };
      });

      setPresetServiceInputs(prev => ({
        ...prev,
        [presetId]: serviceInputs,
      }));

      // Load config for type-specific presets
      const preset = availablePresets.find(p => p.preset_id === presetId);

      if (preset?.contract_line_type === 'Fixed') {
        const fixedConfig = await getContractLinePresetFixedConfig(presetId);
        if (isReturnedActionError(fixedConfig)) {
          onActionError(getErrorMessage(fixedConfig));
          return;
        }
        setPresetFixedConfigs(prev => ({
          ...prev,
          [presetId]: fixedConfig,
        }));

        // Initialize preset rate input if it has a base_rate
        if (fixedConfig?.base_rate !== null && fixedConfig?.base_rate !== undefined) {
          setPresetRateInputs(prev => ({
            ...prev,
            [presetId]: (fixedConfig.base_rate! / 100).toFixed(2),
          }));
        }
      } else if (preset?.contract_line_type === 'Hourly') {
        initializeHourlyPreset(presetId, preset);
      }
    } catch (error) {
      console.error(`Error loading services for preset ${presetId}:`, error);
      onDetailsError?.(t('addLines.errors.failedToLoadPresetDetails', {
        defaultValue: 'Failed to load preset details.',
      }));
    }
  }, [availablePresets, expandedPresets, initializeHourlyPreset, onActionError, onDetailsError, presetServices, t]);

  const getRateInput = useCallback(
    (presetId: string) => presetRateInputs[presetId] || '',
    [presetRateInputs],
  );

  const handleRateInputChange = useCallback((presetId: string, rawValue: string) => {
    const value = rawValue.replace(/[^0-9.]/g, '');
    const decimalCount = (value.match(/\./g) || []).length;
    if (decimalCount > 1) return;

    setPresetRateInputs(prev => ({ ...prev, [presetId]: value }));
  }, []);

  const handleRateInputBlur = useCallback((presetId: string) => {
    const inputValue = presetRateInputs[presetId] || '';

    if (inputValue.trim() === '' || inputValue === '.') {
      setPresetRateInputs(prev => {
        const next = { ...prev };
        delete next[presetId];
        return next;
      });
      setPresetRateOverrides(prev => {
        const next = { ...prev };
        delete next[presetId];
        return next;
      });
      return;
    }

    const dollars = parseFloat(inputValue) || 0;
    const cents = Math.round(dollars * 100);
    setPresetRateOverrides(prev => ({ ...prev, [presetId]: cents }));
    setPresetRateInputs(prev => ({ ...prev, [presetId]: (cents / 100).toFixed(2) }));
  }, [presetRateInputs]);

  const getServiceRateInput = useCallback((presetId: string, service: ContractLinePresetServiceWithName) => {
    const existing = presetServiceInputs[presetId]?.[service.service_id];
    return existing ? existing.rate : (serviceRateInCents(service) / 100).toFixed(2);
  }, [presetServiceInputs]);

  const handleServiceRateChange = useCallback((presetId: string, serviceId: string, rawValue: string) => {
    const value = rawValue.replace(/[^0-9.]/g, '');
    const decimalCount = (value.match(/\./g) || []).length;
    if (decimalCount > 1) return;

    setPresetServiceInputs(prev => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] || {}),
        [serviceId]: { ...(prev[presetId]?.[serviceId] || {}), rate: value },
      },
    }));
  }, []);

  const handleServiceRateBlur = useCallback((presetId: string, service: ContractLinePresetServiceWithName) => {
    const serviceId = service.service_id;
    const dollars = parseFloat(getServiceRateInput(presetId, service)) || 0;
    const cents = Math.round(dollars * 100);

    setPresetServiceOverrides(prev => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] || {}),
        [serviceId]: { ...(prev[presetId]?.[serviceId] || {}), custom_rate: cents },
      },
    }));
    setPresetServiceInputs(prev => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] || {}),
        [serviceId]: { ...(prev[presetId]?.[serviceId] || {}), rate: (cents / 100).toFixed(2) },
      },
    }));
  }, [getServiceRateInput]);

  const getHourlyInput = useCallback(
    (presetId: string, field: HourlyPresetField) =>
      hourlyPresetInputs[presetId]?.[field] || DEFAULT_HOURLY_MINUTES.toString(),
    [hourlyPresetInputs],
  );

  const handleHourlyInputChange = useCallback((presetId: string, field: HourlyPresetField, value: string) => {
    setHourlyPresetInputs(prev => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] || {
          minimum_billable_time: DEFAULT_HOURLY_MINUTES.toString(),
          round_up_to_nearest: DEFAULT_HOURLY_MINUTES.toString(),
        }),
        [field]: value,
      },
    }));
  }, []);

  const handleHourlyInputBlur = useCallback((presetId: string, field: HourlyPresetField) => {
    const value = Math.max(0, parseInt(getHourlyInput(presetId, field)) || 0);

    setHourlyPresetOverrides(prev => ({
      ...prev,
      [presetId]: { ...(prev[presetId] || {}), [field]: value },
    }));
    setHourlyPresetInputs(prev => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] || {
          minimum_billable_time: DEFAULT_HOURLY_MINUTES.toString(),
          round_up_to_nearest: DEFAULT_HOURLY_MINUTES.toString(),
        }),
        [field]: value.toString(),
      },
    }));
  }, [getHourlyInput]);

  /** Overrides to copy the preset with, or undefined when nothing was edited. */
  const buildPresetOverrides = useCallback((presetId: string): ContractLinePresetOverrides | undefined => {
    const overrides: ContractLinePresetOverrides = {};

    // Base rate override for Fixed type presets
    if (presetRateOverrides[presetId] !== undefined) {
      overrides.base_rate = presetRateOverrides[presetId];
    }

    // Hourly configuration overrides
    const hourlyConfig = hourlyPresetOverrides[presetId];
    if (hourlyConfig) {
      if (hourlyConfig.minimum_billable_time !== undefined) {
        overrides.minimum_billable_time = hourlyConfig.minimum_billable_time;
      }
      if (hourlyConfig.round_up_to_nearest !== undefined) {
        overrides.round_up_to_nearest = hourlyConfig.round_up_to_nearest;
      }
    }

    // Service-level overrides (custom_rate)
    const serviceOverrides = presetServiceOverrides[presetId];
    if (serviceOverrides && Object.keys(serviceOverrides).length > 0) {
      overrides.services = {};
      for (const [serviceId, override] of Object.entries(serviceOverrides)) {
        overrides.services[serviceId] = { custom_rate: override.custom_rate };
      }
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [hourlyPresetOverrides, presetRateOverrides, presetServiceOverrides]);

  /**
   * Clears every selection, cache and override map. Overrides keyed by preset id
   * would otherwise survive into the next contract edited in the same dialog.
   */
  const reset = useCallback(() => {
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
  }, []);

  return {
    availablePresets,
    isLoading,
    searchTerm,
    setSearchTerm,
    typeFilter,
    setTypeFilter,
    filteredPresets,
    resetFilters,
    selectedPresetIds,
    toggleSelect,
    expandedPresets,
    toggleExpand,
    presetServices,
    presetFixedConfigs,
    presetServiceCounts,
    getRateInput,
    handleRateInputChange,
    handleRateInputBlur,
    getServiceRateInput,
    handleServiceRateChange,
    handleServiceRateBlur,
    getHourlyInput,
    handleHourlyInputChange,
    handleHourlyInputBlur,
    loadPresets,
    buildPresetOverrides,
    reset,
  };
}

export type ContractLinePresetSelection = ReturnType<typeof useContractLinePresetSelection>;
