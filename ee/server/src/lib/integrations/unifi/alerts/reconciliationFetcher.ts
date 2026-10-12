/**
 * UniFi offline-device alerts for the shared reconciliation poller.
 *
 * UniFi has no alert feed worth mirroring, so an "alert" is derived: a mapped
 * gateway/switch/AP that has been offline longer than `offlineGraceMinutes`.
 * The shared reconciler turns this list into triggered events and synthesizes
 * a reset for every poller-ingested alert that is no longer listed, which is
 * what auto-resolves the ticket when the device returns.
 *
 * Fail-closed: if ANY mapped site cannot be listed this throws, so the
 * reconciler never mistakes "could not look" for "device is back" and resets
 * live alerts.
 *
 * ASSUMPTION (unverified, plan §7.1): whether the API exposes a state-change
 * timestamp. When it does we use it as the outage start; otherwise the first
 * time we observed the device offline is recorded in
 * settings.unifiOfflineObservations and pruned once the device is seen online.
 */

import type {
  NormalizedRmmAlertEvent,
  RmmActiveAlertFetcher,
} from '@alga-psa/shared/rmm/alerts';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { classifyUniFiState, deriveDeviceKind, resolveExternalDeviceId, severityForKind } from '../mappers/deviceMapper';
import { createUniFiClient, type UniFiApiClient, type UniFiConnectionMode } from '../unifiApiClient';
import { loadMappedSites } from '../sync/syncEngine';

export const UNIFI_OFFLINE_ACTIVITY_TYPE = 'DEVICE_OFFLINE';
export const DEFAULT_OFFLINE_GRACE_MINUTES = 5;
const ACTIVE_STATUSES = ['active', 'acknowledged', 'suppressed'];

export interface UniFiAlertFetcherDeps {
  getKnex: () => Promise<any>;
  createClient: (tenantId: string, mode: UniFiConnectionMode) => Promise<Pick<UniFiApiClient, 'listDevices'>>;
  now: () => Date;
}

type Observations = Record<string, string>;

function parseSettings(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) ?? {};
    } catch {
      return {};
    }
  }
  return (value as Record<string, any>) ?? {};
}

export function resolveOfflineGraceMinutes(settings: Record<string, any>): number {
  const raw = Number(settings.offlineGraceMinutes);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_OFFLINE_GRACE_MINUTES;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Per-outage alert id. An existing open row for the same device keeps its id so
 * the outage stays ONE alert across polls; once it resolves, the next outage
 * has a different first-observed time and therefore a new id (a fresh ticket,
 * not a reopen of last week's).
 */
export function offlineAlertId(deviceId: string, firstObservedIso: string): string {
  return `unifi:offline:${deviceId}:${firstObservedIso}`;
}

export function createUniFiAlertFetcher(overrides: Partial<UniFiAlertFetcherDeps> = {}): RmmActiveAlertFetcher {
  const deps: UniFiAlertFetcherDeps = {
    getKnex: getAdminConnection,
    createClient: (tenantId, mode) => createUniFiClient(tenantId, mode),
    now: () => new Date(),
    ...overrides,
  };

  return {
    async fetchActiveAlerts({ tenantId, integrationId }) {
      const knex = await deps.getKnex();
      const db = tenantDb(knex, tenantId);
      const integration = await db
        .table('rmm_integrations')
        .where({ integration_id: integrationId })
        .first('settings');
      const settings = parseSettings(integration?.settings);
      const mode: UniFiConnectionMode = settings.connectionMode === 'local' ? 'local' : 'site_manager';
      const graceMs = resolveOfflineGraceMinutes(settings) * 60_000;
      const observations: Observations = { ...(settings.unifiOfflineObservations ?? {}) };
      const now = deps.now();

      const openRows = await db
        .table('rmm_alerts')
        .where({ integration_id: integrationId, activity_type: UNIFI_OFFLINE_ACTIVITY_TYPE })
        .whereIn('status', ACTIVE_STATUSES)
        .select(['external_device_id', 'external_alert_id']);
      const openIdByDevice = new Map<string, string>();
      for (const row of openRows as any[]) {
        if (row.external_device_id) openIdByDevice.set(String(row.external_device_id), String(row.external_alert_id));
      }

      const client = await deps.createClient(tenantId, mode);
      const sites = await loadMappedSites({ knex } as any, tenantId, integrationId);

      const events: NormalizedRmmAlertEvent[] = [];
      const nextObservations: Observations = {};

      for (const site of sites) {
        // Any listing failure throws: fail closed, nothing is reset on partial data.
        const devices = await client.listDevices(site);
        for (const device of devices) {
          const kind = deriveDeviceKind(device);
          const deviceId = resolveExternalDeviceId(device);
          if (!kind || !deviceId) continue;
          const stateClass = classifyUniFiState(device.state);

          if (stateClass === 'online' || stateClass === 'not_adopted') continue; // observation pruned by omission

          const openId = openIdByDevice.get(deviceId);
          if (stateClass !== 'offline') {
            // Rebooting/updating/unknown: neither a new outage nor proof of recovery.
            // Keep an already-open alert alive and carry its observation forward.
            if (observations[deviceId]) nextObservations[deviceId] = observations[deviceId];
            if (openId) events.push(buildEvent({ tenantId, integrationId, site, device, deviceId, kind, openId, firstObserved: observations[deviceId] ?? now.toISOString(), source: 'held' }));
            continue;
          }

          const apiTimestamp = toIso(device.stateChangedAt);
          const firstObserved = apiTimestamp ?? observations[deviceId] ?? now.toISOString();
          if (!apiTimestamp) nextObservations[deviceId] = firstObserved;

          const offlineForMs = now.getTime() - new Date(firstObserved).getTime();
          if (!openId && offlineForMs < graceMs) continue; // still inside the grace window

          events.push(
            buildEvent({
              tenantId, integrationId, site, device, deviceId, kind,
              openId, firstObserved, source: apiTimestamp ? 'api_timestamp' : 'first_observed',
            })
          );
        }
      }

      // Only reached when every site listed cleanly, so pruning is safe.
      if (JSON.stringify(nextObservations) !== JSON.stringify(observations)) {
        await knex.raw(
          `UPDATE rmm_integrations
              SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{unifiOfflineObservations}', ?::jsonb, true),
                  updated_at = now()
            WHERE tenant = ? AND integration_id = ?`,
          [JSON.stringify(nextObservations), tenantId, integrationId]
        );
      }

      return events;
    },
  };
}

function buildEvent(args: {
  tenantId: string;
  integrationId: string;
  site: { scopeKey: string; siteName: string | null };
  device: { name?: string | null; model?: string | null; state?: string | null };
  deviceId: string;
  kind: 'gateway' | 'switch' | 'access_point';
  openId: string | undefined;
  firstObserved: string;
  source: 'api_timestamp' | 'first_observed' | 'held';
}): NormalizedRmmAlertEvent {
  const label = args.device.name || args.device.model || args.deviceId;
  return {
    tenantId: args.tenantId,
    integrationId: args.integrationId,
    provider: 'unifi',
    kind: 'triggered',
    externalAlertId: args.openId ?? offlineAlertId(args.deviceId, args.firstObserved),
    externalDeviceId: args.deviceId,
    conditionIdentity: UNIFI_OFFLINE_ACTIVITY_TYPE,
    activityType: UNIFI_OFFLINE_ACTIVITY_TYPE,
    alertClass: UNIFI_OFFLINE_ACTIVITY_TYPE,
    sourceType: 'unifi_device',
    severity: severityForKind(args.kind),
    message: `${label} is offline${args.site.siteName ? ` at ${args.site.siteName}` : ''} (since ${args.firstObserved})`,
    deviceName: label,
    externalOrganizationId: args.site.scopeKey,
    occurredAt: args.firstObserved,
    raw: {
      deviceId: args.deviceId,
      kind: args.kind,
      state: args.device.state ?? null,
      firstObservedAt: args.firstObserved,
      observedVia: args.source,
    },
  };
}

export const unifiAlertFetcher: RmmActiveAlertFetcher = createUniFiAlertFetcher();
