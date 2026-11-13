'use client';

import React, { useMemo } from 'react';
import CustomSelect, { type SelectOption } from './CustomSelect';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { useTranslation } from '../lib/i18n/client';
import { parseNumberInput } from '@alga-psa/core/numberInput';
import {
  ASSET_SPEC_OPTIONS, BUILTIN_ASSET_SPEC_FIELDS,
  type AssetSpecOptionGroup, type AssetSpecValue, type AssetSpecValues,
} from '@alga-psa/core/builtinAssetSpecs';

const OPTION_KEYS: Record<AssetSpecOptionGroup, string> = {
  os: 'osTypes', storage: 'storageTypes', network: 'networkDeviceTypes', mobileOs: 'mobileOsTypes',
};

/** Built-in asset types with spec tables, labelled like the asset form; '' leaves the type unknown. */
export function useBuiltinAssetTypeOptions(): SelectOption[] {
  const { t } = useTranslation('msp/assets');
  return useMemo(() => [
    { value: '', label: t('quickAddAsset.assetTypes.unknown', { defaultValue: 'Unknown' }) },
    ...Object.keys(BUILTIN_ASSET_SPEC_FIELDS).map((slug) => ({
      value: slug,
      label: t(`quickAddAsset.assetTypes.${slug}`, {
        defaultValue: slug.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
      }),
    })),
  ], [t]);
}

export function AssetSpecSelect({ optionGroup, ...props }: Omit<React.ComponentProps<typeof CustomSelect>, 'options'> & {
  optionGroup: AssetSpecOptionGroup;
}) {
  const { t } = useTranslation('msp/assets');
  const options: React.ComponentProps<typeof CustomSelect>['options'] = ASSET_SPEC_OPTIONS[optionGroup].map((option) => ({
    value: option.value,
    label: t(`assetForm.${OPTION_KEYS[optionGroup]}.${option.value}`, { defaultValue: option.label }),
  }));
  // OS/storage columns also accept existing free-text values from imports and older forms.
  if (optionGroup !== 'network' && props.value && !options.some((option) => option.value === props.value)) {
    options.push({ value: props.value, label: props.value });
  }
  return <CustomSelect {...props} options={options} />;
}

export function BuiltinAssetSpecFields({ assetType, values, onChange, onBlur, idPrefix }: {
  assetType: string;
  values: AssetSpecValues;
  onChange: (key: string, value: AssetSpecValue, commit?: boolean) => void;
  onBlur?: () => void;
  idPrefix: string;
}) {
  const { t } = useTranslation('msp/assets');
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
    {(BUILTIN_ASSET_SPEC_FIELDS[assetType] ?? []).map((field) => {
      if (field.when && !values[field.when]) return null;
      const id = `${idPrefix}-${field.key.replaceAll('_', '-')}`;
      const label = t(`assetForm.fields.${field.labelKey}`, { defaultValue: field.label });
      const value = values[field.key] ?? field.defaultValue;
      return <div key={field.key}>
        {field.type === 'boolean' ? <Checkbox
          id={id} label={label} checked={value === true}
          onChange={(event) => onChange(field.key, event.target.checked, true)}
        /> : <>
          <label htmlFor={id} className="block text-sm font-medium text-[rgb(var(--color-text-700))]">{label}</label>
          {field.options ? <AssetSpecSelect
            id={id} optionGroup={field.options} value={typeof value === 'string' ? value : ''}
            onValueChange={(selected) => onChange(field.key, selected, true)} className="mt-1"
          /> : <Input
            id={id} type={field.type === 'number' ? 'number' : 'text'}
            min={field.type === 'number' ? 0 : undefined}
            step={field.type === 'number' ? (field.key === 'power_draw_watts' ? 'any' : 1) : undefined}
            value={typeof value === 'string' || typeof value === 'number' ? value : ''}
            onChange={(event) => onChange(field.key, field.type === 'number'
              ? parseNumberInput(event.target.value, { integer: field.key !== 'power_draw_watts' })
              : event.target.value)}
            onBlur={onBlur} className="mt-1"
          />}
        </>}
      </div>;
    })}
  </div>;
}
