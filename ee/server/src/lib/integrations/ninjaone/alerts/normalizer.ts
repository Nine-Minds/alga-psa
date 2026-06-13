import type {
  NormalizedRmmAlertEvent,
  NormalizedRmmAlertEventKind,
  NormalizedRmmAlertSeverity,
} from '@alga-psa/shared/rmm/alerts';
import {
  NinjaOneWebhookPayload,
  NinjaOneAlertSeverity,
  mapAlertSeverity,
} from '../../../../interfaces/ninjaone.interfaces';

/**
 * Maps a NinjaOne CONDITION webhook payload onto the provider-agnostic alert
 * event the shared pipeline consumes. The condition identity for dedup is the
 * NinjaOne statusCode (e.g. CPU_THRESHOLD_EXCEEDED), falling back to the
 * activity type when absent.
 */
export function mapNinjaOneWebhookToAlertEvent(args: {
  tenantId: string;
  integrationId: string;
  payload: NinjaOneWebhookPayload;
  externalOrganizationId?: string | null;
}): NormalizedRmmAlertEvent | null {
  const { payload } = args;

  const externalAlertId = payload.activityId?.toString() || payload.id?.toString();
  if (!externalAlertId) return null;

  const kind = mapStatusToKind(payload.status);
  if (!kind) return null;

  return {
    tenantId: args.tenantId,
    integrationId: args.integrationId,
    provider: 'ninjaone',
    kind,
    externalAlertId,
    externalDeviceId: payload.deviceId != null ? String(payload.deviceId) : null,
    conditionIdentity: payload.statusCode || payload.activityType || null,
    activityType: payload.activityType ?? null,
    alertClass: payload.statusCode ?? null,
    sourceType: payload.type ? String(payload.type).toLowerCase() : 'condition',
    severity: mapAlertSeverity((payload.severity || 'NONE') as NinjaOneAlertSeverity) as NormalizedRmmAlertSeverity,
    message: payload.message || payload.statusCode || null,
    deviceName: payload.device?.displayName || payload.device?.systemName || null,
    externalOrganizationId:
      args.externalOrganizationId ?? (payload.organizationId != null ? String(payload.organizationId) : null),
    occurredAt: parseOccurredAt(payload.activityTime),
    raw: payload as unknown as Record<string, unknown>,
  };
}

/** NinjaOne sends activityTime as epoch seconds in practice; tolerate ISO strings too. */
function parseOccurredAt(activityTime: string | number | undefined): string {
  if (activityTime != null) {
    const numeric = Number(activityTime);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
      const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(activityTime);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function mapStatusToKind(status: string | undefined): NormalizedRmmAlertEventKind | null {
  switch (status) {
    case 'TRIGGERED':
      return 'triggered';
    case 'RESET':
      return 'reset';
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    default:
      return null;
  }
}
