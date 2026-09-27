'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import CustomSelect from './CustomSelect';
import { Input } from './Input';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';
import { unitOfMeasureVocabulary } from '@alga-psa/shared/billingClients/unitOfMeasure';

export interface UnitSelection { code: string; label: string }
interface UnitOfMeasureInputProps {
  value: UnitSelection | string | null;
  onChange: ((value: UnitSelection) => void) | ((value: string) => void);
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  serviceType?: string;
  serviceId?: string;
  onSaveComplete?: () => void;
  customUnits?: UnitSelection[];
  loadCustomUnits?: () => Promise<UnitSelection[]>;
  registerCustomUnit?: (label: string) => Promise<UnitSelection>;
}

const GROUP_ORDER = ['time', 'count', 'volume', 'mass', 'length', 'other'] as const;
const CUSTOM = '__custom_unit__';

export function UnitOfMeasureInput({
  value, onChange, placeholder, className = '', required = false, disabled = false,
  customUnits = [], loadCustomUnits, registerCustomUnit,
  onSaveComplete,
}: UnitOfMeasureInputProps) {
  const { t } = useTranslation();
  const id = useId();
  const [customLabel, setCustomLabel] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [remoteUnits, setRemoteUnits] = useState<UnitSelection[]>([]);
  const unitValue: UnitSelection = typeof value === 'string'
    ? { code: 'C62', label: value }
    : value ?? { code: '', label: '' };
  const emit = (unit: UnitSelection) => {
    if (typeof value === 'string') (onChange as (value: string) => void)(unit.label);
    else (onChange as (value: UnitSelection) => void)(unit);
  };
  const allCustom = [...customUnits, ...remoteUnits];
  useEffect(() => {
    if (loadCustomUnits) void loadCustomUnits().then(setRemoteUnits).catch(() => setRemoteUnits([]));
  }, [loadCustomUnits]);

  const options = useMemo(() => {
    const result: Array<{ value: string; label: string | React.ReactElement; disabled?: boolean; textValue?: string }> = [];
    for (const kind of GROUP_ORDER) {
      const grouped = unitOfMeasureVocabulary.filter((unit) => unit.kind === kind);
      if (!grouped.length) continue;
      result.push({ value: `group-${kind}`, label: t(`unitOfMeasure.groups.${kind}`, { defaultValue: kind }), disabled: true });
      for (const unit of grouped) {
        const label = t(unit.labelKey, { defaultValue: unit.label });
        result.push({ value: unit.key, label, textValue: label });
      }
    }
    if (allCustom.length) {
      result.push({ value: 'group-custom', label: t('unitOfMeasure.groups.custom', { defaultValue: 'Custom' }), disabled: true });
      for (const unit of allCustom) result.push({ value: `custom:${unit.code}:${unit.label}`, label: unit.label });
    }
    result.push({ value: CUSTOM, label: t('unitOfMeasure.customOption', { defaultValue: 'Custom…' }) });
    return result;
  }, [allCustom, t]);

  const selectedValue = useMemo(() => {
    const unit = unitOfMeasureVocabulary.find((candidate) => candidate.code === unitValue.code && candidate.label.toLowerCase() === unitValue.label.toLowerCase());
    if (unit) return unit.key;
    const custom = allCustom.find((candidate) => candidate.code === unitValue.code && candidate.label === unitValue.label);
    return custom ? `custom:${custom.code}:${custom.label}` : '';
  }, [allCustom, unitValue.code, unitValue.label]);

  const handleSelect = (key: string) => {
    if (key === CUSTOM) { setIsCustom(true); setCustomLabel(''); return; }
    if (key.startsWith('custom:')) {
      const [, code, ...labelParts] = key.split(':');
      emit({ code, label: labelParts.join(':') });
      setIsCustom(false);
      return;
    }
    const unit = unitOfMeasureVocabulary.find((candidate) => candidate.key === key);
    if (unit) { emit({ code: unit.code, label: unit.label }); setIsCustom(false); }
  };

  const saveCustom = async () => {
    const label = customLabel.trim();
    if (!label || !registerCustomUnit) return;
    setIsSaving(true);
    try {
      const registered = await registerCustomUnit(label);
      setRemoteUnits((current) => [...current.filter((unit) => unit.label.toLowerCase() !== label.toLowerCase()), registered]);
      emit(registered);
      setIsCustom(false);
      onSaveComplete?.();
    } finally { setIsSaving(false); }
  };

  return <div className={`flex flex-col gap-2 ${className}`}>
    <CustomSelect id={`unit-of-measure-${id}`} options={options} value={selectedValue} onValueChange={handleSelect}
      placeholder={placeholder ?? t('unitOfMeasure.selectPlaceholder', { defaultValue: 'Select a unit' })}
      disabled={disabled || isSaving} required={required} />
    {isCustom && <div className="flex gap-2">
      <Input id={`unit-of-measure-custom-${id}`} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)}
        placeholder={t('unitOfMeasure.customPlaceholder', { defaultValue: 'Name this unit' })} disabled={disabled || isSaving} />
      <Button id={`unit-of-measure-register-${id}`} type="button" onClick={saveCustom} disabled={!customLabel.trim() || !registerCustomUnit || isSaving}>
        {t('unitOfMeasure.register', { defaultValue: 'Add' })}
      </Button>
    </div>}
  </div>;
}
