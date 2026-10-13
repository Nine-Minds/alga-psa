'use client';

import React from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  defaultBlockPriceMinor,
  effectiveBlockPriceMinor,
  majorToMinor,
  minorToMajor,
  type PrepaidBlockConfigDraft,
} from './prepaidBlockConfigDraft';

export interface PrepaidBlockCoveredService {
  service_id: string;
  service_name: string;
  /** Minor units of the contract currency; 0/undefined when not priced yet. */
  hourly_rate?: number;
}

interface PrepaidBlockConfigFieldsProps {
  /** Prefix for element ids (e.g. `prepaid-block-<lineId>` or `custom-line-prepaid-block`). */
  idPrefix: string;
  value: PrepaidBlockConfigDraft;
  onChange: (next: PrepaidBlockConfigDraft) => void;
  /** contracts.currency_code; money is entered and stored in this currency. */
  currencyCode: string;
  coveredServices: PrepaidBlockCoveredService[];
  disabled?: boolean;
  /** Show the validation messages (after a submit attempt). */
  errors?: string[];
  /**
   * Contract templates are currency-neutral: the price is a plain amount (scaled by
   * `currencyCode`'s fraction digits) that takes the client's currency when a contract
   * is created from the template, so the label names no currency.
   */
  neutralPrice?: boolean;
}

/**
 * Editor for a Prepaid Block line's config: block size, price, sold-as service,
 * expiry, and the follow-on triggers. Used by the Create Custom dialog and the
 * line card's inline editor.
 */
export const PrepaidBlockConfigFields: React.FC<PrepaidBlockConfigFieldsProps> = ({
  idPrefix,
  value,
  onChange,
  currencyCode,
  coveredServices,
  disabled = false,
  errors = [],
  neutralPrice = false,
}) => {
  const { t } = useTranslation('msp/contracts');

  const soldAsId = value.soldAsServiceId ?? coveredServices[0]?.service_id ?? null;
  const soldAsService = coveredServices.find((s) => s.service_id === soldAsId);
  const rateForDefault = soldAsService?.hourly_rate;
  const priceMinor = effectiveBlockPriceMinor(value, rateForDefault);
  const suggestedMinor = defaultBlockPriceMinor(value.hours, rateForDefault);
  const hasExpiry = value.expiryMonths.trim() !== '';

  const set = (patch: Partial<PrepaidBlockConfigDraft>) => onChange({ ...value, ...patch });

  return (
    <div id={`${idPrefix}-fields`} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-hours`}>
            {t('prepaidBlock.fields.blockHours', { defaultValue: 'Block size (hours)' })}
          </Label>
          <Input
            id={`${idPrefix}-hours`}
            type="text"
            inputMode="decimal"
            value={value.hours}
            disabled={disabled}
            placeholder="40"
            onChange={(e) => set({ hours: e.target.value.replace(/[^0-9.,]/g, '') })}
          />
          <p className="text-xs text-muted-foreground">
            {t('prepaidBlock.fields.blockHoursHelp', {
              defaultValue: 'Fractions are fine, for example 1.5 for 90 minutes.',
            })}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-price`}>
            {neutralPrice
              ? t('prepaidBlock.fields.blockPriceNeutral', { defaultValue: "Block price (in the client's currency)" })
              : t('prepaidBlock.fields.blockPrice', { defaultValue: 'Block price ({{currency}})', currency: currencyCode })}
          </Label>
          <CurrencyInput
            id={`${idPrefix}-price`}
            value={minorToMajor(priceMinor, currencyCode)}
            currencyCode={currencyCode}
            disabled={disabled}
            onChange={(major) => set({ priceMinor: majorToMinor(major, currencyCode), priceManual: true })}
          />
          <p className="text-xs text-muted-foreground">
            {value.priceManual
              ? t('prepaidBlock.fields.blockPriceManualHelp', {
                defaultValue: 'Set explicitly. It is stored as entered and does not follow the hourly rate.',
              })
              : t('prepaidBlock.fields.blockPriceDefaultHelp', {
                defaultValue: 'Defaults to hours x the service rate. It is saved as an explicit price.',
              })}
          </p>
          {value.priceManual && suggestedMinor !== undefined && suggestedMinor !== value.priceMinor && (
            <button
              type="button"
              id={`${idPrefix}-price-reset`}
              className="text-xs text-[rgb(var(--color-primary-600))] underline"
              disabled={disabled}
              onClick={() => set({ priceManual: false, priceMinor: undefined })}
            >
              {t('prepaidBlock.fields.useRateTimesHours', { defaultValue: 'Use hours x rate' })}
            </button>
          )}
        </div>
      </div>

      {coveredServices.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-sold-as`}>
            {t('prepaidBlock.fields.soldAs', { defaultValue: 'Invoice line is sold as' })}
          </Label>
          <CustomSelect
            id={`${idPrefix}-sold-as`}
            value={soldAsId ?? ''}
            disabled={disabled}
            onValueChange={(next) => set({ soldAsServiceId: next || null })}
            options={coveredServices.map((s) => ({ value: s.service_id, label: s.service_name }))}
          />
          <p className="text-xs text-muted-foreground">
            {t('prepaidBlock.fields.soldAsHelp', {
              defaultValue: 'Drives tax, GL and accounting export mapping for the block invoice line.',
            })}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-expiry-months`}>
            {t('prepaidBlock.fields.expiryMonths', { defaultValue: 'Expires after (months)' })}
          </Label>
          <Input
            id={`${idPrefix}-expiry-months`}
            type="number"
            min={1}
            max={120}
            value={value.expiryMonths}
            disabled={disabled}
            placeholder={t('prepaidBlock.fields.neverExpires', { defaultValue: 'Never expires' })}
            onChange={(e) => {
              const next = e.target.value;
              set({
                expiryMonths: next,
                triggerOnExpiry: next.trim() === '' ? false : value.triggerOnExpiry,
              });
            }}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
          />
          <p className="text-xs text-muted-foreground">
            {t('prepaidBlock.fields.expiryMonthsHelp', {
              defaultValue: 'Leave empty for hours that never expire. Unused hours are forfeited at expiry.',
            })}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-threshold`}>
            {t('prepaidBlock.fields.thresholdPercent', { defaultValue: 'Issue next block at usage (%)' })}
          </Label>
          <Input
            id={`${idPrefix}-threshold`}
            type="number"
            min={1}
            max={99}
            value={value.thresholdPercent}
            disabled={disabled}
            placeholder={t('prepaidBlock.fields.noThreshold', { defaultValue: 'No threshold' })}
            onChange={(e) => set({ thresholdPercent: e.target.value })}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
        <p className="text-sm font-medium">
          {t('prepaidBlock.fields.triggersHeading', { defaultValue: 'Invoice the next block when' })}
        </p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-trigger-exhaustion`}>
            {t('prepaidBlock.fields.triggerExhaustion', { defaultValue: 'The block runs out' })}
          </Label>
          <Switch
            id={`${idPrefix}-trigger-exhaustion`}
            checked={value.triggerOnExhaustion}
            disabled={disabled}
            onCheckedChange={(checked) => set({ triggerOnExhaustion: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-trigger-expiry`}>
            {t('prepaidBlock.fields.triggerExpiry', { defaultValue: 'The block expires' })}
          </Label>
          <Switch
            id={`${idPrefix}-trigger-expiry`}
            checked={hasExpiry && value.triggerOnExpiry}
            disabled={disabled || !hasExpiry}
            onCheckedChange={(checked) => set({ triggerOnExpiry: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor={`${idPrefix}-trigger-renewal`}>
              {t('prepaidBlock.fields.triggerRenewal', { defaultValue: 'The contract renews' })}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('prepaidBlock.fields.triggerRenewalPending', {
                defaultValue: 'Saved with the line. How renewals issue blocks is pending policy confirmation, so this does not issue anything yet.',
              })}
            </p>
          </div>
          <Switch
            id={`${idPrefix}-trigger-renewal`}
            checked={value.triggerOnRenewal}
            disabled={disabled}
            onCheckedChange={(checked) => set({ triggerOnRenewal: checked })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-tier`}>
          {t('prepaidBlock.fields.tier', { defaultValue: 'Follow-on invoice' })}
        </Label>
        <CustomSelect
          id={`${idPrefix}-tier`}
          value={value.replenishmentTier}
          disabled={disabled}
          onValueChange={(next) => set({ replenishmentTier: next === 'auto_issue' ? 'auto_issue' : 'draft' })}
          options={[
            { value: 'draft', label: t('prepaidBlock.fields.tierDraft', { defaultValue: 'Create a draft for review' }) },
            { value: 'auto_issue', label: t('prepaidBlock.fields.tierAutoIssue', { defaultValue: 'Finalize and send automatically' }) },
          ]}
        />
      </div>

      {errors.length > 0 && (
        <ul id={`${idPrefix}-errors`} className="list-disc pl-5 text-sm text-destructive">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PrepaidBlockConfigFields;
