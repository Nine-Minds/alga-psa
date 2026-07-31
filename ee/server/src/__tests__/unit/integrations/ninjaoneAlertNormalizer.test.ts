import { describe, expect, it } from 'vitest';
import { mapNinjaOneWebhookToAlertEvent } from '@ee/lib/integrations/ninjaone/alerts/normalizer';
import type { NinjaOneWebhookPayload } from '@ee/interfaces/ninjaone.interfaces';

const BASE: NinjaOneWebhookPayload = {
  activityId: 12345,
  activityTime: '2026-06-12T10:00:00.000Z',
  activityType: 'CONDITION',
  statusCode: 'DISK_SPACE_LOW',
  status: 'TRIGGERED',
  type: 'CONDITION',
  message: 'Disk C: low on space',
  deviceId: 77,
  organizationId: 500,
  device: { id: 77, displayName: 'SERVER-01', systemName: 'srv01' },
} as NinjaOneWebhookPayload;

const ARGS = { tenantId: 'tenant-1', integrationId: 'integration-1' };

describe('mapNinjaOneWebhookToAlertEvent', () => {
  it('maps a TRIGGERED condition payload', () => {
    const event = mapNinjaOneWebhookToAlertEvent({ ...ARGS, payload: BASE });
    expect(event).toMatchObject({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      provider: 'ninjaone',
      kind: 'triggered',
      externalAlertId: '12345',
      externalDeviceId: '77',
      conditionIdentity: 'DISK_SPACE_LOW',
      alertClass: 'DISK_SPACE_LOW',
      activityType: 'CONDITION',
      sourceType: 'condition',
      message: 'Disk C: low on space',
      deviceName: 'SERVER-01',
      externalOrganizationId: '500',
      occurredAt: '2026-06-12T10:00:00.000Z',
    });
  });

  it.each([
    ['RESET', 'reset'],
    ['ACKNOWLEDGED', 'acknowledged'],
  ] as const)('maps %s status to kind %s', (status, kind) => {
    const event = mapNinjaOneWebhookToAlertEvent({ ...ARGS, payload: { ...BASE, status } });
    expect(event?.kind).toBe(kind);
  });

  it('returns null for unknown statuses and missing alert ids', () => {
    expect(mapNinjaOneWebhookToAlertEvent({ ...ARGS, payload: { ...BASE, status: 'NONSENSE' } })).toBeNull();
    expect(
      mapNinjaOneWebhookToAlertEvent({
        ...ARGS,
        payload: { ...BASE, activityId: undefined, id: undefined },
      })
    ).toBeNull();
  });

  it.each([
    ['CRITICAL', 'critical'],
    ['MAJOR', 'major'],
    ['MODERATE', 'moderate'],
    ['MINOR', 'minor'],
    ['NONE', 'none'],
    [undefined, 'none'],
  ] as const)('normalizes severity %s to %s', (input, expected) => {
    const event = mapNinjaOneWebhookToAlertEvent({
      ...ARGS,
      payload: { ...BASE, severity: input as NinjaOneWebhookPayload['severity'] },
    });
    expect(event?.severity).toBe(expected);
  });

  it('falls back to activityType for condition identity when statusCode is absent', () => {
    const event = mapNinjaOneWebhookToAlertEvent({
      ...ARGS,
      payload: { ...BASE, statusCode: undefined },
    });
    expect(event?.conditionIdentity).toBe('CONDITION');
  });

  it('tolerates epoch-seconds activityTime and falls back to id for the alert id', () => {
    const event = mapNinjaOneWebhookToAlertEvent({
      ...ARGS,
      payload: { ...BASE, activityId: undefined, id: 999, activityTime: 1781258400 as unknown as string },
    });
    expect(event?.externalAlertId).toBe('999');
    expect(event?.occurredAt).toBe(new Date(1781258400 * 1000).toISOString());
  });
});
