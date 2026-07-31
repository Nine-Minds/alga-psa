import type { Asset, AssetSummaryMetrics, RmmStorageInfo } from '@alga-psa/types';
import type { BentoTone } from '@alga-psa/ui/components/bento';

/**
 * Injected translator. These stay pure functions — `t` is a parameter rather
 * than a hook — so they remain testable and usable outside React, while the
 * strings they produce are still localisable. (They previously returned
 * hardcoded English, which showed through untranslated on every locale.)
 */
export type TFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * The derived facts every asset surface reads — detail hero, list rows, and the
 * client Assets tab. Kept in one place so "is this device healthy" can't mean
 * three different things in three views.
 */

export const HEALTH_TONE: Record<AssetSummaryMetrics['health_status'], BentoTone> = {
  healthy: 'good', warning: 'warn', critical: 'bad', unknown: 'neutral',
};
export const SECURITY_TONE: Record<AssetSummaryMetrics['security_status'], BentoTone> = {
  secure: 'good', at_risk: 'warn', critical: 'bad',
};
export const WARRANTY_TONE: Record<AssetSummaryMetrics['warranty_status'], BentoTone> = {
  active: 'good', expiring_soon: 'warn', expired: 'bad', unknown: 'neutral',
};
export const AGENT_TONE: Record<string, BentoTone> = {
  online: 'good', offline: 'bad', overdue: 'warn', unknown: 'neutral',
};

/** "Windows" + "Windows 11 Pro" is one product — RMM agents repeat the family. */
export function osLabel(osType?: string, osVersion?: string): string | undefined {
  const type = osType?.trim();
  const version = osVersion?.trim();
  if (!type) return version || undefined;
  if (!version) return type;
  return version.toLowerCase().startsWith(type.toLowerCase()) ? version : `${type} ${version}`;
}

/** The raw field goes negative once cover lapses; "-129d left" is not a phrase. */
export function warrantyPhrase(days: number | null | undefined, t: TFn): string | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days > 0) return t('assetSignals.warranty.daysLeft', { defaultValue: '{{count}}d left', count: days });
  if (days === 0) return t('assetSignals.warranty.expiresToday', { defaultValue: 'expires today' });
  return t('assetSignals.warranty.expiredAgo', { defaultValue: 'expired {{count}}d ago', count: Math.abs(days) });
}

export function warrantyDaysRemaining(asset: Asset, now: number): number | null {
  if (!asset.warranty_end_date) return null;
  const end = new Date(asset.warranty_end_date).getTime();
  return Number.isFinite(end) ? Math.round((end - now) / 86_400_000) : null;
}

export function warrantyToneFor(asset: Asset, now: number): BentoTone {
  const days = warrantyDaysRemaining(asset, now);
  if (days == null) return 'neutral';
  if (days < 0) return 'bad';
  if (days < 60) return 'warn';
  return 'good';
}

export function formatUptime(seconds: number | null | undefined, t: TFn): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return t('assetSignals.duration.dayHour', { defaultValue: '{{days}}d {{hours}}h', days, hours });
  if (hours > 0) return t('assetSignals.duration.hourMinute', { defaultValue: '{{hours}}h {{minutes}}m', hours, minutes });
  return t('assetSignals.duration.minute', { defaultValue: '{{minutes}}m', minutes });
}

/** Relative age. `now` is injected so this stays pure and testable. */
export function formatAge(iso: string | null | undefined, now: number, t: TFn): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return t('assetSignals.age.justNow', { defaultValue: 'just now' });
  if (minutes < 60) return t('assetSignals.age.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('assetSignals.age.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('assetSignals.age.daysAgo', { defaultValue: '{{count}}d ago', count: days });
  return new Date(iso).toLocaleDateString();
}

/** The disk the operator cares about is the fullest one. */
export function worstStorage(storage: RmmStorageInfo[] | undefined): RmmStorageInfo | null {
  if (!storage?.length) return null;
  return storage.reduce((worst, current) =>
    current.utilization_percent > worst.utilization_percent ? current : worst
  );
}

/** The per-type extension row carrying RMM/patch state, if this asset has one. */
export function assetExtension(asset: Asset) {
  return asset.workstation ?? asset.server;
}

export interface PatchSummary {
  pending: number | null;
  failed: number | null;
  lastScanAt?: string;
  tone: BentoTone;
  /** Null when the asset has no RMM agent — the caller renders "unmanaged". */
  label: string | null;
}

export function patchSummary(asset: Asset, t: TFn): PatchSummary {
  const ext = assetExtension(asset);
  const managed = Boolean(asset.rmm_provider);
  if (!ext || !managed) {
    return { pending: null, failed: null, tone: 'neutral', label: null };
  }
  const split = (ext.pending_os_patches ?? 0) + (ext.pending_software_patches ?? 0);
  const pending = split > 0 ? split : (ext.pending_patches ?? null);
  const failed = ext.failed_patches ?? null;
  const tone: BentoTone = (failed ?? 0) > 0 ? 'bad' : (pending ?? 0) > 0 ? 'warn' : 'good';
  const label =
    (failed ?? 0) > 0 ? t('assetSignals.patching.failed', { defaultValue: '{{count}} failed', count: failed })
      : (pending ?? 0) > 0 ? t('assetSignals.patching.pending', { defaultValue: '{{count}} pending', count: pending })
        : t('assetSignals.patching.upToDate', { defaultValue: 'up to date' });
  return { pending, failed, lastScanAt: ext.last_patch_scan_at, tone, label };
}

export function isRmmManaged(asset: Asset): boolean {
  return Boolean(asset.rmm_provider);
}
