'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import CustomSelect from './CustomSelect';
import { Input } from './Input';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';
import {
  knownUnitCodeForLabel,
  unitOfMeasureVocabulary,
  type UnitOfMeasure,
} from '@alga-psa/core/unitOfMeasure';

export interface UnitSelection { code: string; label: string }
interface UnitOfMeasureInputProps {
  /** Base for the ids of the interactive elements; defaults to a generated id. */
  id?: string;
  /**
   * Object mode: `{ code, label }` in, `{ code, label }` out.
   * String mode: the stored label in, the chosen label out (the code is derived from the label).
   */
  value: UnitSelection | string | null;
  onChange: ((value: UnitSelection) => void) | ((value: string) => void);
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** Offer a "clear" entry that emits an empty unit (for optional overrides). */
  allowClear?: boolean;
  /** Accepted for compatibility with older callers; unused. */
  serviceType?: string;
  /** Accepted for compatibility with older callers; unused. */
  serviceId?: string;
  onSaveComplete?: () => void;
  customUnits?: UnitSelection[];
  /** Loaded once on mount. */
  loadCustomUnits?: () => Promise<UnitSelection[]>;
  /** Persists a custom unit; when omitted, custom labels are kept locally. */
  registerCustomUnit?: (label: string) => Promise<UnitSelection>;
}

const GROUP_ORDER = ['time', 'count', 'volume', 'mass', 'length', 'other'] as const;
const CUSTOM = '__custom_unit__';
const EMPTY_UNITS: UnitSelection[] = [];

const normalize = (label: string) => label.trim().toLowerCase();
const customKey = (unit: UnitSelection) => `custom:${unit.code}:${unit.label}`;

function vocabularyMatches(unit: UnitOfMeasure, selection: UnitSelection): boolean {
  if (unit.code !== selection.code) return false;
  const label = normalize(selection.label);
  return [unit.label, unit.key, unit.pluralLabel, unit.shortLabel].some((candidate) => normalize(candidate) === label);
}

function toSelection(value: UnitSelection | string | null): UnitSelection {
  if (value === null) return { code: '', label: '' };
  const label = typeof value === 'string' ? value : value.label ?? '';
  const code = typeof value === 'string' ? '' : value.code ?? '';
  if (code || !label.trim()) return { code, label };
  return { code: knownUnitCodeForLabel(label) ?? 'C62', label };
}

export function UnitOfMeasureInput({
  id: idProp, value, onChange, placeholder, className = '', required = false, disabled = false, allowClear = false,
  customUnits = EMPTY_UNITS, loadCustomUnits, registerCustomUnit, onSaveComplete,
}: UnitOfMeasureInputProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const baseId = idProp ?? `unit-of-measure-${generatedId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [customLabel, setCustomLabel] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [remoteUnits, setRemoteUnits] = useState<UnitSelection[]>(EMPTY_UNITS);

  const unitValue = useMemo(() => toSelection(value), [value]);
  const emit = (unit: UnitSelection) => {
    if (typeof value === 'string') (onChange as (value: string) => void)(unit.label);
    else (onChange as (value: UnitSelection) => void)(unit);
  };

  const loadCustomUnitsRef = useRef(loadCustomUnits);
  loadCustomUnitsRef.current = loadCustomUnits;
  useEffect(() => {
    const load = loadCustomUnitsRef.current;
    if (!load) return;
    let cancelled = false;
    load()
      .then((units) => { if (!cancelled) setRemoteUnits(units); })
      .catch(() => { if (!cancelled) setRemoteUnits(EMPTY_UNITS); });
    return () => { cancelled = true; };
  }, []);

  const allCustom = useMemo(() => {
    const seen = new Set<string>();
    return [...customUnits, ...remoteUnits].filter((unit) => {
      const key = customKey(unit);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [customUnits, remoteUnits]);

  const { selectedValue, syntheticUnit } = useMemo(() => {
    if (!unitValue.label.trim()) return { selectedValue: '', syntheticUnit: null };
    const unit = unitOfMeasureVocabulary.find((candidate) => vocabularyMatches(candidate, unitValue));
    if (unit) return { selectedValue: unit.key, syntheticUnit: null };
    const custom = allCustom.find((candidate) =>
      candidate.code === unitValue.code && normalize(candidate.label) === normalize(unitValue.label));
    if (custom) return { selectedValue: customKey(custom), syntheticUnit: null };
    // Keep an existing value visible even when it is not in the vocabulary or the tenant's units.
    return { selectedValue: customKey(unitValue), syntheticUnit: unitValue };
  }, [allCustom, unitValue]);

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
    const customOptions = syntheticUnit ? [...allCustom, syntheticUnit] : allCustom;
    if (customOptions.length) {
      result.push({ value: 'group-custom', label: t('unitOfMeasure.groups.custom', { defaultValue: 'Custom' }), disabled: true });
      for (const unit of customOptions) result.push({ value: customKey(unit), label: unit.label, textValue: unit.label });
    }
    result.push({ value: CUSTOM, label: t('unitOfMeasure.customOption', { defaultValue: 'Custom…' }) });
    return result;
  }, [allCustom, syntheticUnit, t]);

  const handleSelect = (key: string) => {
    if (key === CUSTOM) { setIsCustom(true); setCustomLabel(''); return; }
    if (key === '') {
      if (!allowClear) return;
      emit({ code: '', label: '' });
      setIsCustom(false);
      return;
    }
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
    if (!label) return;
    setIsSaving(true);
    try {
      // Without a registrar (e.g. client-only editors) the label is kept locally with its derived code.
      const registered = registerCustomUnit
        ? await registerCustomUnit(label)
        : { code: knownUnitCodeForLabel(label) ?? 'C62', label };
      setRemoteUnits((current) => [...current.filter((unit) => normalize(unit.label) !== normalize(label)), registered]);
      emit(registered);
      setIsCustom(false);
      onSaveComplete?.();
    } finally { setIsSaving(false); }
  };

  return <div className={`flex flex-col gap-2 ${className}`}>
    <CustomSelect id={baseId} options={options} value={selectedValue} onValueChange={handleSelect}
      placeholder={placeholder ?? t('unitOfMeasure.selectPlaceholder', { defaultValue: 'Select a unit' })}
      disabled={disabled || isSaving} required={required} allowClear={allowClear} />
    {isCustom && <div className="flex gap-2">
      <Input id={`${baseId}-custom`} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)}
        placeholder={t('unitOfMeasure.customPlaceholder', { defaultValue: 'Name this unit' })} disabled={disabled || isSaving} />
      <Button id={`${baseId}-register`} type="button" onClick={saveCustom} disabled={!customLabel.trim() || isSaving}>
        {t('unitOfMeasure.register', { defaultValue: 'Add' })}
      </Button>
    </div>}
  </div>;
}
