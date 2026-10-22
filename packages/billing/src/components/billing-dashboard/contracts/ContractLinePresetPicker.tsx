'use client';

import React from 'react';
import { resolveUnitOfMeasure } from '@alga-psa/core/unitOfMeasure';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Search, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import {
  useContractLineTypeOptions,
  useFormatBillingFrequency,
  useFormatContractLineType,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';
import type { ContractLinePresetSelection } from './useContractLinePresetSelection';

interface ContractLinePresetPickerProps {
  selection: ContractLinePresetSelection;
  /** Already-translated chrome copy, which differs between the two dialogs. */
  labels: {
    searchPlaceholder: string;
    noneAvailable: string;
    noMatches: string;
  };
  typeFilterId: string;
  resetFiltersId: string;
  filtersClassName?: string;
  listClassName?: string;
  /** Currency of the contract the preset is being added to. */
  currencyCode: string;
}

/**
 * Preset list with the expanded Fixed/Hourly/Usage rate editors, shared by
 * ContractDialog and AddContractLinesDialog. All state lives in
 * useContractLinePresetSelection so both dialogs edit presets identically.
 */
export const ContractLinePresetPicker: React.FC<ContractLinePresetPickerProps> = ({
  selection,
  labels,
  typeFilterId,
  resetFiltersId,
  filtersClassName = 'flex flex-wrap items-center gap-2',
  listClassName = 'overflow-y-auto border rounded-md p-2 space-y-1',
  currencyCode,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { money, symbol } = useCurrencyFormat();
  const contractLineTypeOptions = useContractLineTypeOptions();
  const formatContractLineType = useFormatContractLineType();
  const formatBillingFrequency = useFormatBillingFrequency();

  const {
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
  } = selection;

  return (
    <>
      {/* Search and Filter Row */}
      <div className={filtersClassName}>
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder={labels.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Type Filter */}
        <div className="w-48">
          <CustomSelect
            id={typeFilterId}
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
            id={resetFiltersId}
            variant="outline"
            size="sm"
            onClick={resetFilters}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t('addLines.filters.reset', { defaultValue: 'Reset' })}
          </Button>
        )}
      </div>

      {/* Contract Line Presets List */}
      <div className={listClassName}>
        {isLoading ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            {t('addLines.loading', { defaultValue: 'Loading contract line presets...' })}
          </div>
        ) : availablePresets.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            {labels.noneAvailable}
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            {labels.noMatches}
          </div>
        ) : (
          filteredPresets.map((preset) => {
            if (!preset.preset_id) return null;
            const presetId = preset.preset_id;
            const isExpanded = expandedPresets[presetId];
            const services = presetServices[presetId] || [];
            const serviceCount = presetServiceCounts[presetId] || 0;
            const fixedConfig = presetFixedConfigs[presetId];
            const isSelected = selectedPresetIds.has(presetId);

            return (
              <div key={presetId} className="border rounded bg-card shadow-sm">
                {/* Main row - clickable to expand */}
                <div
                  className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => toggleExpand(presetId)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      id={`preset-${presetId}`}
                      checked={isSelected}
                      onChange={() => toggleSelect(presetId)}
                      aria-label={isSelected
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
                                ? money(Number(fixedConfig.base_rate), currencyCode)
                                : t('addLines.fixedConfig.notSet', { defaultValue: 'Not set' })}
                            </span>
                          </div>
                          <div>
                            <Label htmlFor={`rate-override-${presetId}`} className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                              {t('addLines.fixedConfig.overrideBaseRate', { defaultValue: 'Override Base Rate' })}
                            </Label>
                            <Input
                              leadingAdornment={symbol(currencyCode)}
                              containerClassName="mt-1.5"
                              id={`rate-override-${presetId}`}
                              type="text"
                              inputMode="decimal"
                              value={getRateInput(presetId)}
                              onChange={(e) => handleRateInputChange(presetId, e.target.value)}
                              onBlur={() => handleRateInputBlur(presetId)}
                              placeholder={fixedConfig?.base_rate
                                ? t('addLines.fixedConfig.defaultRatePlaceholder', {
                                  defaultValue: 'Default: {{rate}}',
                                  rate: money(Number(fixedConfig.base_rate), currencyCode),
                                })
                                : t('addLines.fixedConfig.enterBaseRate', { defaultValue: 'Enter base rate' })}
                              className="h-9 text-sm"
                            />
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
                                <Label htmlFor={`min-billable-${presetId}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                  {t('addLines.hourlyConfig.minimumBillableMinutes', { defaultValue: 'Minimum billable minutes' })}
                                </Label>
                                <Input
                                  id={`min-billable-${presetId}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={getHourlyInput(presetId, 'minimum_billable_time')}
                                  onChange={(e) => handleHourlyInputChange(presetId, 'minimum_billable_time', e.target.value)}
                                  onBlur={() => handleHourlyInputBlur(presetId, 'minimum_billable_time')}
                                  className="h-9 text-sm mt-1"
                                />
                              </div>
                              <div>
                                <Label htmlFor={`round-up-${presetId}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                  {t('addLines.hourlyConfig.roundUpToNearest', { defaultValue: 'Round up to nearest (minutes)' })}
                                </Label>
                                <Input
                                  id={`round-up-${presetId}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={getHourlyInput(presetId, 'round_up_to_nearest')}
                                  onChange={(e) => handleHourlyInputChange(presetId, 'round_up_to_nearest', e.target.value)}
                                  onBlur={() => handleHourlyInputBlur(presetId, 'round_up_to_nearest')}
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
                              {services.map((service) => (
                                <div key={service.service_id} className="bg-muted rounded-md p-3 border border-[rgb(var(--color-border-200))]">
                                  <div className="font-medium text-sm text-[rgb(var(--color-text-900))] mb-2">{service.service_name}</div>
                                  <div>
                                    <Label htmlFor={`hourly-rate-${presetId}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                      {t('addLines.hourlyConfig.hourlyRate', { defaultValue: 'Hourly Rate' })}
                                    </Label>
                                    <Input
                                      leadingAdornment={symbol(currencyCode)}
                                      containerClassName="mt-1"
                                      id={`hourly-rate-${presetId}-${service.service_id}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={getServiceRateInput(presetId, service)}
                                      onChange={(e) => handleServiceRateChange(presetId, service.service_id, e.target.value)}
                                      onBlur={() => handleServiceRateBlur(presetId, service)}
                                      placeholder={(service.default_rate! / 100).toFixed(2)}
                                      className="h-9 text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {t('addLines.hourlyConfig.defaultRate', {
                                        defaultValue: 'Default: {{rate}}',
                                        rate: money(Number(service.default_rate), currencyCode),
                                      })}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* For Usage presets, show rate and unit of measure — usage bills from recorded usage, never a configured quantity */
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            {t('addLines.usageConfig.recordDrivenNote', {
                              defaultValue:
                                'Usage services bill from usage recorded in Usage Tracking for each service period. A period with no usage record produces no charge — record usage (or an explicit zero) each period to bill these services.',
                            })}
                          </p>
                          {services.map((service) => (
                            <div key={service.service_id} className="bg-muted rounded-md p-3 border border-[rgb(var(--color-border-200))]">
                              <div className="font-medium text-sm text-[rgb(var(--color-text-900))] mb-2">{service.service_name}</div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label htmlFor={`rate-${presetId}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                    {t('addLines.usageConfig.ratePerUnit', { defaultValue: 'Rate (per unit)' })}
                                  </Label>
                                  <Input
                                    leadingAdornment={symbol(currencyCode)}
                                    containerClassName="mt-1"
                                    id={`rate-${presetId}-${service.service_id}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={getServiceRateInput(presetId, service)}
                                    onChange={(e) => handleServiceRateChange(presetId, service.service_id, e.target.value)}
                                    onBlur={() => handleServiceRateBlur(presetId, service)}
                                    placeholder={(service.default_rate! / 100).toFixed(2)}
                                    className="h-9 text-sm"
                                  />
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {t('addLines.usageConfig.defaultRate', {
                                      defaultValue: 'Default: {{rate}}',
                                      rate: money(Number(service.default_rate), currencyCode),
                                    })}
                                  </p>
                                </div>
                                <div>
                                  <Label htmlFor={`unit-measure-${presetId}-${service.service_id}`} className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                    {t('addLines.usageConfig.unitOfMeasure', { defaultValue: 'Unit of Measure' })}
                                  </Label>
                                  <Input
                                    id={`unit-measure-${presetId}-${service.service_id}`}
                                    type="text"
                                    value={service.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label}
                                    disabled
                                    className="h-9 text-sm mt-1 bg-muted"
                                  />
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {t('addLines.usageConfig.unitHint', { defaultValue: 'e.g., GB, API call, user' })}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
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
    </>
  );
};

export default ContractLinePresetPicker;
