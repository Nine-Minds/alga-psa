import type { NormalizedRmmAlertEvent } from './contracts';

/**
 * Dedup identity: one open ticket per (device, condition). The condition part
 * prefers the normalizer-supplied identity (e.g. NinjaOne statusCode), then
 * progressively less specific fields.
 */
export function computeDedupKey(event: NormalizedRmmAlertEvent): string {
  const device = event.externalDeviceId ?? 'no-device';
  const condition =
    event.conditionIdentity ?? event.alertClass ?? event.activityType ?? event.sourceType ?? 'unknown';
  return `${device}|${condition}`.slice(0, 255);
}
