import type { NormalizedRmmAlertEvent, RmmActiveAlertFetcher } from '@alga-psa/shared/rmm/alerts';
import { registerRmmAlertFetcher } from '@alga-psa/shared/rmm/alerts';
import { buildTacticalClientForTenant } from './buildClient';

/**
 * Lists currently-active TacticalRMM alerts for reconciliation, using the
 * same filterable alerts endpoint the manual backfill verified (PATCH
 * /alerts/ with a status filter; permissive about response shape).
 */
export const tacticalRmmAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts({ tenantId, integrationId }) {
    const client = await buildTacticalClientForTenant(tenantId);
    if (!client) return [];

    const res = await client.request<any>({
      method: 'PATCH',
      path: '/alerts/',
      data: { status: 'active' },
    });
    const alerts: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.results)
        ? (res as any).results
        : Array.isArray((res as any)?.alerts)
          ? (res as any).alerts
          : [];

    return alerts
      .filter((alert) => !isResolved(alert))
      .map((alert) => mapTacticalAlertToEvent(alert, tenantId, integrationId))
      .filter((event): event is NormalizedRmmAlertEvent => event !== null);
  },
};

function isResolved(alert: any): boolean {
  if (alert?.resolved === true) return true;
  const status = alert?.status ? String(alert.status).toLowerCase() : '';
  return status === 'resolved';
}

export function mapTacticalAlertToEvent(
  alert: any,
  tenantId: string,
  integrationId: string
): NormalizedRmmAlertEvent | null {
  const externalAlertId = String(alert?.id ?? alert?.alert_id ?? alert?.uid ?? '');
  if (!externalAlertId) return null;

  const agentId = String(alert?.agent_id ?? alert?.device_id ?? alert?.agent ?? alert?.device ?? '');
  const message = String(alert?.message ?? alert?.alert_message ?? alert?.description ?? '');
  const triggeredAt = alert?.alert_time || alert?.triggered_at || alert?.created || new Date().toISOString();

  return {
    tenantId,
    integrationId,
    provider: 'tacticalrmm',
    kind: 'triggered',
    externalAlertId,
    externalDeviceId: agentId || null,
    conditionIdentity: alert?.check_id
      ? String(alert.check_id)
      : alert?.alert_type
        ? String(alert.alert_type)
        : null,
    activityType: 'tacticalrmm_alert',
    alertClass: alert?.alert_type ? String(alert.alert_type) : null,
    sourceType: 'tacticalrmm_alert',
    severity: mapTacticalSeverity(alert?.severity ?? alert?.alert_severity),
    message: message || null,
    deviceName: alert?.hostname ? String(alert.hostname) : alert?.agent_hostname ? String(alert.agent_hostname) : null,
    externalOrganizationId: alert?.client_id != null ? String(alert.client_id) : null,
    occurredAt: toIso(triggeredAt),
    raw: (alert ?? {}) as Record<string, unknown>,
  };
}

function mapTacticalSeverity(input: unknown): NormalizedRmmAlertEvent['severity'] {
  const raw = String(input || '').toLowerCase();
  if (!raw) return 'none';
  if (raw.includes('crit') || raw.includes('error')) return 'critical';
  if (raw.includes('major') || raw.includes('high')) return 'major';
  if (raw.includes('moder') || raw.includes('warn')) return 'moderate';
  if (raw.includes('minor') || raw.includes('low') || raw.includes('info')) return 'minor';
  return 'none';
}

function toIso(value: unknown): string {
  // Tactical RMM may send timestamps as epoch seconds/ms (number or numeric
  // string, e.g. "1776073284"). new Date(<numeric string>) misparses those and
  // the raw value reaches the rmm_alerts timestamp column → Postgres
  // "date/time field value out of range". Normalize epochs explicitly.
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value.trim()))) {
    const num = Number(value);
    const ms = Math.abs(num) < 1e12 ? num * 1000 : num; // 10-digit → seconds, 13-digit → ms
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// Registration is a module side effect so any importer (the reconciliation
// dispatcher, the manual backfill action) gets the fetcher wired.
registerRmmAlertFetcher('tacticalrmm', tacticalRmmAlertFetcher);
