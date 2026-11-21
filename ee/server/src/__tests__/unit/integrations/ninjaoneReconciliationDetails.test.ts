import { describe, expect, it } from 'vitest';
import { mapAlertToEvent } from '../../../lib/integrations/ninjaone/alerts/reconciliationFetcher';
import type { NinjaOneAlert } from '../../../interfaces/ninjaone.interfaces';

describe('NinjaOne reconciliation alert details contract', () => {
  it('maps the typed alerts-list message and leaves details absent because that API shape has no body field', () => {
    const providerAlert: NinjaOneAlert = {
      uid: 'alert-1', deviceId: 7, severity: 'CRITICAL', priority: 'CRITICAL',
      message: 'CPU threshold exceeded', createTime: '2026-10-01T12:00:00Z', sourceType: 'CONDITION',
      data: { statusCode: 'CPU_THRESHOLD_EXCEEDED' },
    };
    const event = mapAlertToEvent(providerAlert, 'tenant', 'integration');
    expect(event.message).toBe('CPU threshold exceeded');
    expect(event.details).toBeNull();
  });
});
