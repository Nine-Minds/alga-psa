'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';
import {
  CUSTODY_NEXT_ACTION_PARTIES,
  CUSTODY_PURPOSES,
  type CustodyAccessory,
  type CustodyNextActionParty,
  type CustodyPurpose,
  type ICustodyLocationOption,
} from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toCalendarDateString } from '@alga-psa/core';
import { calendarDateToLocalDate } from '../../lib/calendarDate';
import { useCustodyBins } from './custodyClient';

/** Mirrors CUSTODY_BIN_MAX_LENGTH / CUSTODY_NOTE_MAX_LENGTH in lib/schemas/assetCustody.schema (server-only import). */
export const CUSTODY_BIN_MAX = 64;
export const CUSTODY_NOTE_MAX = 2000;

export function usePurposeOptions() {
  const { t } = useTranslation('msp/assets');
  const labels: Record<CustodyPurpose, string> = {
    repair: t('custody.purpose.repair', { defaultValue: 'Repair' }),
    warranty_evaluation: t('custody.purpose.warranty_evaluation', { defaultValue: 'Warranty evaluation' }),
    loaner_prep: t('custody.purpose.loaner_prep', { defaultValue: 'Loaner preparation' }),
    staging: t('custody.purpose.staging', { defaultValue: 'Staging' }),
  };
  return CUSTODY_PURPOSES.map((value) => ({ value, label: labels[value] }));
}

export function usePartyLabels(): Record<CustodyNextActionParty, string> {
  const { t } = useTranslation('msp/assets');
  return {
    msp: t('custody.party.msp', { defaultValue: 'Us (MSP)' }),
    client: t('custody.party.client', { defaultValue: 'Client' }),
    vendor: t('custody.party.vendor', { defaultValue: 'Vendor' }),
  };
}

export function CustodyPlaceFields({
  idPrefix,
  locations,
  locationId,
  bin,
  onLocationChange,
  onBinChange,
  locationLabel,
  allowKeepLocation = false,
}: {
  idPrefix: string;
  locations: ICustodyLocationOption[];
  locationId: string;
  bin: string;
  onLocationChange: (locationId: string) => void;
  onBinChange: (bin: string) => void;
  locationLabel?: string;
  /** Move may keep the current location (empty value); everything else needs one. */
  allowKeepLocation?: boolean;
}) {
  const { t } = useTranslation('msp/assets');
  const suggestions = useCustodyBins(locationId || null);
  const listId = `${idPrefix}-bin-options`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-location`}>
          {locationLabel ?? t('custody.fields.location', { defaultValue: 'Location' })}
        </Label>
        <CustomSelect
          id={`${idPrefix}-location`}
          value={locationId || null}
          onValueChange={onLocationChange}
          options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
          placeholder={
            allowKeepLocation
              ? t('custody.fields.keepLocation', { defaultValue: 'Keep current location' })
              : t('custody.fields.selectLocation', { defaultValue: 'Select a location' })
          }
          allowClear={allowKeepLocation}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-bin`}>{t('custody.fields.bin', { defaultValue: 'Bin or shelf' })}</Label>
        <Input
          id={`${idPrefix}-bin`}
          value={bin}
          maxLength={CUSTODY_BIN_MAX}
          list={listId}
          placeholder={t('custody.fields.binPlaceholder', { defaultValue: 'e.g. Shelf B3' })}
          onChange={(e) => onBinChange(e.target.value)}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

export interface CustodyDetailsValue {
  purpose: CustodyPurpose;
  next_action_party: CustodyNextActionParty;
  /** `YYYY-MM-DD` or ''. Never routed through Date/timezone conversion. */
  follow_up_on: string;
  next_action_note: string;
  condition_note: string;
  accessories: CustodyAccessory[];
}

export function emptyCustodyDetails(): CustodyDetailsValue {
  return {
    purpose: 'repair',
    next_action_party: 'msp',
    follow_up_on: '',
    next_action_note: '',
    condition_note: '',
    accessories: [],
  };
}

/** Drop blank accessory rows before sending. */
export function cleanAccessories(rows: CustodyAccessory[]): CustodyAccessory[] {
  return rows
    .map((r) => ({ label: r.label.trim(), quantity: Math.max(1, Math.floor(Number(r.quantity) || 1)) }))
    .filter((r) => r.label.length > 0);
}

export function CustodyDetailFields({
  idPrefix,
  value,
  onChange,
  showPurpose = true,
}: {
  idPrefix: string;
  value: CustodyDetailsValue;
  onChange: (next: CustodyDetailsValue) => void;
  showPurpose?: boolean;
}) {
  const { t } = useTranslation('msp/assets');
  const purposes = usePurposeOptions();
  const parties = usePartyLabels();
  const set = <K extends keyof CustodyDetailsValue>(key: K, v: CustodyDetailsValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {showPurpose ? (
          <div>
            <Label htmlFor={`${idPrefix}-purpose`}>{t('custody.fields.purpose', { defaultValue: 'Purpose' })}</Label>
            <CustomSelect
              id={`${idPrefix}-purpose`}
              value={value.purpose}
              onValueChange={(v) => set('purpose', v as CustodyPurpose)}
              options={purposes}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${idPrefix}-party`}>
            {t('custody.fields.nextActionParty', { defaultValue: 'Next action is with' })}
          </Label>
          <CustomSelect
            id={`${idPrefix}-party`}
            value={value.next_action_party}
            onValueChange={(v) => set('next_action_party', v as CustodyNextActionParty)}
            options={CUSTODY_NEXT_ACTION_PARTIES.map((p) => ({ value: p, label: parties[p] }))}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-follow-up`}>
            {t('custody.fields.followUpOn', { defaultValue: 'Follow up on' })}
          </Label>
          <DatePicker
            id={`${idPrefix}-follow-up`}
            clearable
            value={calendarDateToLocalDate(value.follow_up_on)}
            onChange={(date) => set('follow_up_on', date ? toCalendarDateString(date) ?? '' : '')}
            placeholder={t('custody.fields.followUpPlaceholder', { defaultValue: 'Select a date' })}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-next-note`}>
          {t('custody.fields.nextActionNote', { defaultValue: 'Next action note' })}
        </Label>
        <TextArea
          id={`${idPrefix}-next-note`}
          rows={2}
          maxLength={CUSTODY_NOTE_MAX}
          value={value.next_action_note}
          onChange={(e) => set('next_action_note', e.target.value)}
        />
        <p className="mt-1 text-xs text-[rgb(var(--color-text-400))]">
          {t('custody.fields.internalNote', { defaultValue: 'Internal. Never printed on a label or shown to the client.' })}
        </p>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-condition`}>
          {t('custody.fields.conditionNote', { defaultValue: 'Condition' })}
        </Label>
        <TextArea
          id={`${idPrefix}-condition`}
          rows={2}
          maxLength={CUSTODY_NOTE_MAX}
          value={value.condition_note}
          onChange={(e) => set('condition_note', e.target.value)}
          placeholder={t('custody.fields.conditionPlaceholder', { defaultValue: 'Scratches, missing screws, damage on arrival' })}
        />
      </div>
      <CustodyAccessoriesEditor
        idPrefix={idPrefix}
        value={value.accessories}
        onChange={(rows) => set('accessories', rows)}
      />
    </div>
  );
}

export function CustodyAccessoriesEditor({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: CustodyAccessory[];
  onChange: (rows: CustodyAccessory[]) => void;
}) {
  const { t } = useTranslation('msp/assets');
  return (
    <div>
      <Label>{t('custody.fields.accessories', { defaultValue: 'Accessories received' })}</Label>
      <div className="space-y-2">
        {value.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-accessory-${index}-label`}
              containerClassName="flex-1"
              value={row.label}
              maxLength={120}
              placeholder={t('custody.fields.accessoryPlaceholder', { defaultValue: 'e.g. Power adapter' })}
              onChange={(e) => onChange(value.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))}
            />
            <Input
              id={`${idPrefix}-accessory-${index}-qty`}
              containerClassName="w-20"
              type="number"
              min={1}
              max={999}
              value={row.quantity}
              aria-label={t('custody.fields.accessoryQuantity', { defaultValue: 'Quantity' })}
              onChange={(e) =>
                onChange(value.map((r, i) => (i === index ? { ...r, quantity: Number(e.target.value) || 1 } : r)))
              }
            />
            <Button
              id={`${idPrefix}-accessory-${index}-remove`}
              type="button"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <span className="sr-only">{t('custody.fields.removeAccessory', { defaultValue: 'Remove accessory' })}</span>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          id={`${idPrefix}-add-accessory`}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { label: '', quantity: 1 }])}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('custody.fields.addAccessory', { defaultValue: 'Add accessory' })}
        </Button>
      </div>
    </div>
  );
}
