import { describe, expect, it } from 'vitest';
import { ActivityPriority } from '@alga-psa/types';
import { mapStoredNotificationPriority } from './notificationPriority';

describe('mapStoredNotificationPriority (task 29.8.46 activities mapper)', () => {
  it('uses the stored priority when present (stored wins over type)', () => {
    // stored 'low' beats a type of 'error' that would legacy-derive HIGH
    expect(mapStoredNotificationPriority('low', 'error')).toBe(ActivityPriority.LOW);
    expect(mapStoredNotificationPriority('high', 'info')).toBe(ActivityPriority.HIGH);
    expect(mapStoredNotificationPriority('normal', 'error')).toBe(ActivityPriority.MEDIUM);
  });

  it('falls back to the legacy type derivation when stored priority is absent', () => {
    expect(mapStoredNotificationPriority(null, 'error')).toBe(ActivityPriority.HIGH);
    expect(mapStoredNotificationPriority(undefined, 'warning')).toBe(ActivityPriority.MEDIUM);
    expect(mapStoredNotificationPriority(null, 'info')).toBe(ActivityPriority.LOW);
    expect(mapStoredNotificationPriority(undefined, undefined)).toBe(ActivityPriority.LOW);
  });

  it('falls back to legacy when the stored value is not a recognized tier', () => {
    expect(mapStoredNotificationPriority('bogus', 'warning')).toBe(ActivityPriority.MEDIUM);
  });

  it('preserves legacy type mapping while the feature flag is off', () => {
    expect(mapStoredNotificationPriority('low', 'error', false)).toBe(ActivityPriority.HIGH);
    expect(mapStoredNotificationPriority('high', 'warning', false)).toBe(ActivityPriority.MEDIUM);
    expect(mapStoredNotificationPriority('high', 'info', false)).toBe(ActivityPriority.LOW);
  });
});
