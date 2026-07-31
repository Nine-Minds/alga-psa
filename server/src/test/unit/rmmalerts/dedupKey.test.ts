import { describe, it, expect } from 'vitest';
import { computeDedupKey } from '@alga-psa/shared/rmm/alerts';
import type { NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';

function event(overrides: Partial<NormalizedRmmAlertEvent> = {}): NormalizedRmmAlertEvent {
  return {
    tenantId: 't',
    integrationId: 'i',
    provider: 'ninjaone',
    kind: 'triggered',
    externalAlertId: 'a-1',
    externalDeviceId: 'dev-1',
    conditionIdentity: 'DISK_SPACE',
    activityType: 'CONDITION',
    alertClass: 'CLASS',
    sourceType: 'condition',
    severity: 'major',
    occurredAt: '2026-06-12T10:00:00.000Z',
    raw: {},
    ...overrides,
  };
}

describe('computeDedupKey', () => {
  it('combines device and condition identity', () => {
    expect(computeDedupKey(event())).toBe('dev-1|DISK_SPACE');
  });

  it('same condition on different devices yields different keys', () => {
    expect(computeDedupKey(event({ externalDeviceId: 'dev-2' }))).not.toBe(computeDedupKey(event()));
  });

  it('falls back through alertClass, activityType, sourceType', () => {
    expect(computeDedupKey(event({ conditionIdentity: null }))).toBe('dev-1|CLASS');
    expect(computeDedupKey(event({ conditionIdentity: null, alertClass: null }))).toBe('dev-1|CONDITION');
    expect(
      computeDedupKey(event({ conditionIdentity: null, alertClass: null, activityType: null }))
    ).toBe('dev-1|condition');
    expect(
      computeDedupKey(event({ conditionIdentity: null, alertClass: null, activityType: null, sourceType: null }))
    ).toBe('dev-1|unknown');
  });

  it('handles missing device and caps length at 255', () => {
    expect(computeDedupKey(event({ externalDeviceId: null }))).toBe('no-device|DISK_SPACE');
    const long = computeDedupKey(event({ conditionIdentity: 'x'.repeat(400) }));
    expect(long.length).toBe(255);
  });
});
