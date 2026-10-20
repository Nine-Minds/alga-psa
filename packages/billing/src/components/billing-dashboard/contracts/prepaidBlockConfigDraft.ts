import { fromMinorUnits, toMinorUnits } from '@alga-psa/core';
import type { IPrepaidBlockConfigFields, PrepaidBlockReplenishmentTier } from '@alga-psa/types';
import type { PrepaidBlockConfigInput } from '../../../services/prepaidBlockConfigService';

/**
 * UI draft for the Prepaid Block config editor. Hours are free text so
 * fractional blocks ("1.5") can be typed; the stored unit is integer minutes.
 * Money stays in minor units of the contract currency end to end; the price
 * defaults to hours x the covered service's rate until the user types one, but
 * is always submitted (and stored) explicitly.
 */
export interface PrepaidBlockConfigDraft {
  hours: string;
  /** Minor units; only meaningful when priceManual. */
  priceMinor: number | undefined;
  priceManual: boolean;
  soldAsServiceId: string | null;
  /** '' = never expires. */
  expiryMonths: string;
  triggerOnExhaustion: boolean;
  /** '' = no threshold trigger. */
  thresholdPercent: string;
  triggerOnExpiry: boolean;
  triggerOnRenewal: boolean;
  replenishmentTier: PrepaidBlockReplenishmentTier;
}

export type PrepaidBlockDraftErrorCode =
  | 'hoursInvalid'
  | 'priceInvalid'
  | 'expiryInvalid'
  | 'thresholdInvalid'
  | 'serviceRequired';

export function emptyPrepaidBlockDraft(): PrepaidBlockConfigDraft {
  return {
    hours: '',
    priceMinor: undefined,
    priceManual: false,
    soldAsServiceId: null,
    expiryMonths: '12',
    triggerOnExhaustion: true,
    thresholdPercent: '',
    triggerOnExpiry: true,
    triggerOnRenewal: false,
    replenishmentTier: 'draft',
  };
}

/** Minutes -> editable hours text without float noise (90 -> "1.5", 2400 -> "40"). */
export function minutesToHoursText(minutes: number): string {
  return String(Math.round((minutes / 60) * 1e6) / 1e6);
}

export function hoursTextToMinutes(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const minutes = parseFloat(normalized) * 60;
  const rounded = Math.round(minutes);
  if (!Number.isFinite(minutes) || Math.abs(minutes - rounded) > 1e-6 || rounded <= 0) return null;
  return rounded;
}

export function draftFromConfig(config: IPrepaidBlockConfigFields & { sold_as_service_id?: string | null }): PrepaidBlockConfigDraft {
  return {
    hours: minutesToHoursText(Number(config.block_minutes)),
    priceMinor: Number(config.block_price),
    priceManual: true,
    soldAsServiceId: config.sold_as_service_id ?? null,
    expiryMonths: config.expiry_months == null ? '' : String(config.expiry_months),
    triggerOnExhaustion: Boolean(config.trigger_on_exhaustion),
    thresholdPercent: config.trigger_threshold_percent == null ? '' : String(config.trigger_threshold_percent),
    triggerOnExpiry: Boolean(config.trigger_on_expiry),
    triggerOnRenewal: Boolean(config.trigger_on_renewal),
    replenishmentTier: config.replenishment_tier,
  };
}

/** hours x hourly rate, in minor units. Undefined until both are known. */
export function defaultBlockPriceMinor(
  draftHours: string,
  hourlyRateMinor: number | undefined,
): number | undefined {
  const minutes = hoursTextToMinutes(draftHours);
  if (minutes === null || !hourlyRateMinor || hourlyRateMinor <= 0) return undefined;
  return Math.round((minutes * hourlyRateMinor) / 60);
}

export function effectiveBlockPriceMinor(
  draft: PrepaidBlockConfigDraft,
  hourlyRateMinor: number | undefined,
): number | undefined {
  return draft.priceManual ? draft.priceMinor : defaultBlockPriceMinor(draft.hours, hourlyRateMinor);
}

export function draftToInput(
  draft: PrepaidBlockConfigDraft,
  hourlyRateMinor: number | undefined,
): { input: PrepaidBlockConfigInput } | { errors: PrepaidBlockDraftErrorCode[] } {
  const errors: PrepaidBlockDraftErrorCode[] = [];
  const minutes = hoursTextToMinutes(draft.hours);
  if (minutes === null) errors.push('hoursInvalid');
  const price = effectiveBlockPriceMinor(draft, hourlyRateMinor);
  if (price === undefined || !Number.isSafeInteger(price) || price < 0) errors.push('priceInvalid');

  const expiryText = draft.expiryMonths.trim();
  const expiry = expiryText === '' ? null : Number(expiryText);
  if (expiry !== null && (!Number.isInteger(expiry) || expiry < 1 || expiry > 120)) errors.push('expiryInvalid');

  const thresholdText = draft.thresholdPercent.trim();
  const threshold = thresholdText === '' ? null : Number(thresholdText);
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 1 || threshold > 99)) errors.push('thresholdInvalid');

  if (errors.length > 0) return { errors };
  return {
    input: {
      block_minutes: minutes as number,
      block_price: price as number,
      sold_as_service_id: draft.soldAsServiceId,
      expiry_months: expiry,
      trigger_on_exhaustion: draft.triggerOnExhaustion,
      trigger_threshold_percent: threshold,
      trigger_on_expiry: expiry === null ? false : draft.triggerOnExpiry,
      trigger_on_renewal: draft.triggerOnRenewal,
      replenishment_tier: draft.replenishmentTier,
    },
  };
}

/** Major-unit number for CurrencyInput from minor units in the contract currency. */
export function minorToMajor(minor: number | undefined, currencyCode: string, locale?: string): number | undefined {
  return minor === undefined ? undefined : fromMinorUnits(minor, locale, currencyCode);
}

export function majorToMinor(major: number | undefined, currencyCode: string, locale?: string): number | undefined {
  return major === undefined || Number.isNaN(major) ? undefined : toMinorUnits(major, locale, currencyCode);
}

/**
 * A Prepaid Block line as authored in a wizard: its own Hourly services plus the block
 * config draft. `hourly_rate` is minor units (contract currency in the client wizard;
 * template rates are optional and currency-neutral).
 */
export interface PrepaidBlockLineDraft {
  name?: string;
  services: Array<{ service_id: string; service_name?: string; hourly_rate?: number }>;
  block: PrepaidBlockConfigDraft;
}

export function emptyPrepaidBlockLineDraft(): PrepaidBlockLineDraft {
  return { name: '', services: [{ service_id: '', service_name: '', hourly_rate: undefined }], block: emptyPrepaidBlockDraft() };
}

/** Rate used for "hours x rate" and the sold-as default: the sold-as service's rate, else the first service's. */
export function prepaidLineSoldAsRate(line: PrepaidBlockLineDraft): number | undefined {
  const picked = line.services.filter((s) => s.service_id);
  const target = picked.find((s) => s.service_id === line.block.soldAsServiceId) ?? picked[0];
  return target?.hourly_rate || undefined;
}

export type PrepaidBlockLineSubmission = {
  name?: string;
  services: Array<{ service_id: string; service_name?: string; hourly_rate?: number }>;
  block: PrepaidBlockConfigInput;
};

/**
 * Convert wizard drafts to submission entries. Lines with no picked service are dropped
 * (the wizard treats them as not yet started); a line with services but an invalid block
 * config reports its draft error codes.
 */
export function prepaidLineDraftsToSubmission(
  lines: PrepaidBlockLineDraft[] | undefined,
): { lines: PrepaidBlockLineSubmission[] } | { errors: Array<{ lineIndex: number; codes: PrepaidBlockDraftErrorCode[] }> } {
  const out: PrepaidBlockLineSubmission[] = [];
  const errors: Array<{ lineIndex: number; codes: PrepaidBlockDraftErrorCode[] }> = [];
  (lines ?? []).forEach((line, lineIndex) => {
    const services = line.services.filter((s) => s.service_id);
    if (services.length === 0) return;
    const parsed = draftToInput(line.block, prepaidLineSoldAsRate(line));
    if ('errors' in parsed) {
      errors.push({ lineIndex, codes: parsed.errors });
      return;
    }
    out.push({
      name: line.name?.trim() || undefined,
      services: services.map((s) => ({
        service_id: s.service_id,
        service_name: s.service_name,
        hourly_rate: s.hourly_rate,
      })),
      block: parsed.input,
    });
  });
  return errors.length > 0 ? { errors } : { lines: out };
}

/** Resumed/persisted submission entry -> editable draft. */
export function prepaidLineDraftFromSubmission(entry: PrepaidBlockLineSubmission): PrepaidBlockLineDraft {
  const { block } = entry;
  return {
    name: entry.name ?? '',
    services: entry.services.map((s) => ({ ...s })),
    block: {
      hours: minutesToHoursText(block.block_minutes),
      priceMinor: block.block_price,
      priceManual: true,
      soldAsServiceId: block.sold_as_service_id ?? null,
      expiryMonths: block.expiry_months == null ? '' : String(block.expiry_months),
      triggerOnExhaustion: Boolean(block.trigger_on_exhaustion),
      thresholdPercent: block.trigger_threshold_percent == null ? '' : String(block.trigger_threshold_percent),
      triggerOnExpiry: Boolean(block.trigger_on_expiry),
      triggerOnRenewal: Boolean(block.trigger_on_renewal),
      replenishmentTier: block.replenishment_tier ?? 'draft',
    },
  };
}
