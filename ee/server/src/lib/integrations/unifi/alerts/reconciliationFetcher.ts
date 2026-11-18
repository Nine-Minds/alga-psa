/** UniFi adapter for the shared, durable observation-derived condition lifecycle. */
import type {
  NormalizedRmmAlertEvent,
  RmmActiveAlertFetcher,
  RmmActiveAlertSnapshot,
} from '@alga-psa/shared/rmm/alerts';
import { reconcileConditionObservations } from '@alga-psa/shared/rmm/alerts';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { randomUUID } from 'node:crypto';
import {
  classifyUniFiState,
  deriveDeviceKind,
  mapDeviceKindToNetworkType,
  resolveExternalDeviceId,
  severityForKind,
} from '../mappers/deviceMapper';
import { createUniFiClient, type UniFiClientSurface, type UniFiConnectionMode } from '../unifiApiClient';
import { MAPPED_SITE_COLUMNS, mappedSiteFromRow, type MappedSite } from '../sync/syncEngine';

export const UNIFI_OFFLINE_ACTIVITY_TYPE = 'DEVICE_OFFLINE';
export const DEFAULT_OFFLINE_GRACE_MINUTES = 5;

export interface UniFiAlertFetcherDeps {
  getKnex: () => Promise<any>;
  createClient: (tenantId: string, mode: UniFiConnectionMode) => Promise<Pick<UniFiClientSurface, 'listDevices'>>;
  now: () => Date;
}

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

function resolveAlertPollingIntervalMinutes(settings: Record<string, any>): number {
  const raw = Number(settings.alertPolling?.intervalMinutes);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Import the first implementation's settings map and RMM alert rows once per
 * call, under an integration row lock. INSERT ... DO NOTHING makes retries
 * harmless; the old map is removed only after all state rows are committed.
 */
export async function initializeUniFiConditionState(knex: any, tenantId: string, integrationId: string): Promise<void> {
  await knex.transaction(async (trx: any) => {
    const db = tenantDb(trx, tenantId);
    const integration = await db
      .table('rmm_integrations')
      .where({ integration_id: integrationId })
      .forUpdate()
      .first('settings');
    if (!integration) return;
    const settings = parseSettings(integration.settings);
    const pending = parseSettings(settings.unifiOfflineObservations) as Record<string, unknown>;
    const alerts = await db
      .table('rmm_alerts')
      .where({
        integration_id: integrationId,
        activity_type: UNIFI_OFFLINE_ACTIVITY_TYPE,
      })
      .select('external_device_id', 'external_alert_id', 'status', 'triggered_at', 'metadata');
    const deviceIds = [
      ...new Set(
        alerts
          .map((row: any) => row.external_device_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const mappings = deviceIds.length
      ? await db
          .table('tenant_external_entity_mappings')
          .where({ integration_type: 'unifi', alga_entity_type: 'asset' })
          .whereIn('external_entity_id', deviceIds)
          .select('external_entity_id', 'external_realm_id')
      : [];
    const realmByDevice = new Map<string, string>(
      mappings.map((row: any) => [String(row.external_entity_id), String(row.external_realm_id ?? '')]),
    );
    const scopeOf = (deviceId: string, metadata: unknown) => {
      const meta = parseSettings(metadata);
      return String(meta.scopeKey || realmByDevice.get(deviceId) || `legacy-unknown:${deviceId}`);
    };

    for (const [deviceId, firstSeenValue] of Object.entries(pending)) {
      const firstSeen = toIso(firstSeenValue);
      if (!firstSeen) continue;
      const active = alerts.find(
        (row: any) =>
          String(row.external_device_id ?? '') === deviceId &&
          ['active', 'acknowledged', 'suppressed'].includes(row.status),
      );
      if (active) continue; // An existing alert ID and ticket link win over pending settings metadata.
      await db
        .table('rmm_condition_states')
        .insert({
          tenant: tenantId,
          integration_id: integrationId,
          scope_key: String(realmByDevice.get(deviceId) || `legacy-unknown:${deviceId}`),
          subject_key: deviceId,
          condition_key: 'device_offline',
          state: 'pending',
          last_observation_at: firstSeen,
          last_observation_kind: 'failing',
          last_trusted_evidence_at: firstSeen,
          pending_since: firstSeen,
          current_outage_id: null,
        })
        .onConflict(['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key'])
        .ignore();
    }

    for (const row of alerts) {
      if (!['active', 'acknowledged', 'suppressed'].includes(row.status) || !row.external_device_id) continue;
      const deviceId = String(row.external_device_id);
      const outageId = randomUUID();
      await db
        .table('rmm_condition_states')
        .insert({
          tenant: tenantId,
          integration_id: integrationId,
          scope_key: scopeOf(deviceId, row.metadata),
          subject_key: deviceId,
          condition_key: 'device_offline',
          state: 'firing',
          last_observation_at: toIso(row.triggered_at) ?? new Date().toISOString(),
          last_observation_kind: 'failing',
          last_trusted_evidence_at: toIso(row.triggered_at) ?? new Date().toISOString(),
          current_outage_id: outageId,
          current_external_alert_id: row.external_alert_id,
        })
        .onConflict(['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key'])
        .ignore();
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'unifiOfflineObservations')) {
      await trx.raw(
        `UPDATE rmm_integrations SET settings = COALESCE(settings, '{}'::jsonb) - 'unifiOfflineObservations', updated_at = now()
        WHERE tenant = ? AND integration_id = ?`,
        [tenantId, integrationId],
      );
    }
  });
}

/** Resolve incomplete legacy scopes when a device is next observed in a mapped site. */
export async function attachLegacyUnknownScopes(
  knex: any,
  tenantId: string,
  integrationId: string,
  observations: Parameters<typeof reconcileConditionObservations>[0]['observations'],
): Promise<string[]> {
  const heldLegacyIds: string[] = [];
  await knex.transaction(async (trx: any) => {
    const db = tenantDb(trx, tenantId);
    for (const observation of observations) {
      const legacyScope = `legacy-unknown:${observation.subjectKey}`;
      if (observation.scopeKey === legacyScope) continue;
      const legacy = await db
        .table('rmm_condition_states')
        .where({
          integration_id: integrationId,
          scope_key: legacyScope,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
        })
        .forUpdate()
        .first();
      if (!legacy) continue;
      const current = await db
        .table('rmm_condition_states')
        .where({
          integration_id: integrationId,
          scope_key: observation.scopeKey,
          subject_key: observation.subjectKey,
          condition_key: observation.conditionKey,
        })
        .forUpdate()
        .first();
      if (!current) {
        await db
          .table('rmm_condition_states')
          .where({
            integration_id: integrationId,
            scope_key: legacyScope,
            subject_key: observation.subjectKey,
            condition_key: observation.conditionKey,
          })
          .update({
            scope_key: observation.scopeKey,
            updated_at: trx.fn.now(),
          });
      } else if (legacy.state === 'firing' || legacy.state === 'unmanaged') {
        // Keep the imported alert identity if a placeholder was created before
        // legacy metadata could be matched. The alert row and its ticket remain untouched.
        if (current.state !== 'firing' && current.state !== 'unmanaged') {
          await db
            .table('rmm_condition_states')
            .where({
              integration_id: integrationId,
              scope_key: observation.scopeKey,
              subject_key: observation.subjectKey,
              condition_key: observation.conditionKey,
            })
            .update({
              state: legacy.state,
              current_outage_id: legacy.current_outage_id,
              current_external_alert_id: legacy.current_external_alert_id,
              pending_since: legacy.pending_since,
              last_observation_at: legacy.last_observation_at,
              last_observation_kind: legacy.last_observation_kind,
              last_trusted_evidence_at: legacy.last_trusted_evidence_at,
              event_payload: legacy.event_payload,
              updated_at: trx.fn.now(),
            });
          await db
            .table('rmm_condition_states')
            .where({
              integration_id: integrationId,
              scope_key: legacyScope,
              subject_key: observation.subjectKey,
              condition_key: observation.conditionKey,
            })
            .delete();
        } else if (legacy.current_external_alert_id) {
          heldLegacyIds.push(legacy.current_external_alert_id);
        }
      } else {
        await db
          .table('rmm_condition_states')
          .where({
            integration_id: integrationId,
            scope_key: legacyScope,
            subject_key: observation.subjectKey,
            condition_key: observation.conditionKey,
          })
          .delete();
      }
    }
  });
  return heldLegacyIds;
}

export function createUniFiAlertFetcher(overrides: Partial<UniFiAlertFetcherDeps> = {}): RmmActiveAlertFetcher {
  const deps: UniFiAlertFetcherDeps = {
    getKnex: getAdminConnection,
    createClient: (tenantId, mode) => createUniFiClient(tenantId, mode),
    now: () => new Date(),
    ...overrides,
  };

  const fetchSnapshot = async ({
    tenantId,
    integrationId,
  }: {
    tenantId: string;
    integrationId: string;
  }): Promise<RmmActiveAlertSnapshot> => {
    const knex = await deps.getKnex();
    await initializeUniFiConditionState(knex, tenantId, integrationId);
    const db = tenantDb(knex, tenantId);
    const integration = await db.table('rmm_integrations').where({ integration_id: integrationId }).first('settings');
    const settings = parseSettings(integration?.settings);
    const mode: UniFiConnectionMode = settings.connectionMode === 'local' ? 'local' : 'site_manager';
    const managementObservedAt = deps.now().toISOString();
    const sites = await loadAlertSites(knex, tenantId, integrationId);
    const successfulScopes: string[] = [];
    const failedScopes: string[] = [];
    const scopeObservationTimes: Record<string, string> = {};
    const observations: Parameters<typeof reconcileConditionObservations>[0]['observations'] = [];
    let client: Pick<UniFiClientSurface, 'listDevices'> | null = null;
    if (sites.length > 0) {
      try {
        client = await deps.createClient(tenantId, mode);
      } catch {
        // Provider connection setup failure is uncertainty for every mapped
        // site. Still drain the durable transition outbox below.
        for (const site of sites) {
          failedScopes.push(site.scopeKey);
          scopeObservationTimes[site.scopeKey] = deps.now().toISOString();
        }
      }
    }
    for (const site of sites) {
      if (!client) continue;
      const requestedAt = deps.now();
      scopeObservationTimes[site.scopeKey] = requestedAt.toISOString();
      try {
        const devices = await client.listDevices(site);
        successfulScopes.push(site.scopeKey);
        for (const device of devices) {
          const kind = deriveDeviceKind(device);
          const deviceId = resolveExternalDeviceId(device);
          if (!kind || !deviceId) continue;
          const state = classifyUniFiState(device.state);
          const evidence = state === 'offline' ? 'failing' : state === 'online' ? 'healthy' : 'uncertain';
          const observedAt = requestedAt.toISOString();
          const failingSince = evidence === 'failing' ? toIso(device.stateChangedAt) : null;
          const label = device.name || device.model || deviceId;
          const alertClass = kind === 'gateway' ? mapDeviceKindToNetworkType(kind, device.model) : kind;
          observations.push({
            scopeKey: site.scopeKey,
            subjectKey: deviceId,
            conditionKey: 'device_offline',
            evidence,
            observedAt,
            failingSince,
            event: {
              tenantId,
              integrationId,
              provider: 'unifi',
              externalDeviceId: deviceId,
              conditionIdentity: 'device_offline',
              activityType: UNIFI_OFFLINE_ACTIVITY_TYPE,
              alertClass,
              sourceType: 'unifi_device_state',
              severity: evidence === 'healthy' ? 'none' : severityForKind(kind),
              message: `${label} is ${evidence === 'failing' ? 'offline' : evidence === 'healthy' ? 'online' : 'in an uncertain state'}${site.siteName ? ` at ${site.siteName}` : ''}`,
              deviceName: label,
              externalOrganizationId: site.scopeKey,
              raw: {
                deviceId,
                scopeKey: site.scopeKey,
                state: device.state ?? null,
                kind,
              },
            },
          });
        }
      } catch {
        // A failed site contributes no evidence. Other scopes remain processable.
        failedScopes.push(site.scopeKey);
      }
    }

    const stateScopes = await db
      .table('rmm_condition_states')
      .where({ integration_id: integrationId })
      .distinct('scope_key');
    const currentScopes = new Set(sites.map((site) => site.scopeKey));
    const unmanagedScopes = stateScopes
      .map((row: { scope_key: string }) => String(row.scope_key))
      .filter((scope: string) => !currentScopes.has(scope) && !scope.startsWith('legacy-unknown:'));
    const heldLegacyIds = await attachLegacyUnknownScopes(knex, tenantId, integrationId, observations);
    const lifecycle = await reconcileConditionObservations({
      knex,
      tenantId,
      integrationId,
      observations,
      successfulScopes,
      failedScopes,
      scopeObservationTimes,
      unmanagedScopes,
      unmanagedObservedAt: managementObservedAt,
      graceMs: resolveOfflineGraceMinutes(settings) * 60_000,
      maxEvidenceGapMs: Math.max(
        5 * 60_000,
        resolveOfflineGraceMinutes(settings) * 120_000,
        resolveAlertPollingIntervalMinutes(settings) * 120_000,
      ),
      now: deps.now(),
    });
    // Durable delivery occurs after the condition transaction commits.
    // runRmmAlertReconciliation also feeds these explicit events to the same pipeline;
    // its retry-safe event identity remains the delivery boundary.
    return {
      events: lifecycle.events,
      heldExternalAlertIds: [...lifecycle.heldExternalAlertIds, ...heldLegacyIds],
    };
  };

  return {
    async fetchActiveAlerts(args) {
      return (await fetchSnapshot(args)).events;
    },
    fetchActiveAlertSnapshot: fetchSnapshot,
  };
}

export const unifiAlertFetcher: RmmActiveAlertFetcher = createUniFiAlertFetcher();

async function loadAlertSites(knex: any, tenant: string, integrationId: string): Promise<MappedSite[]> {
  const rows = await tenantDb(knex, tenant)
    .table('rmm_organization_mappings')
    .where({ integration_id: integrationId })
    .whereNotNull('client_id')
    .select(MAPPED_SITE_COLUMNS);
  const sites: MappedSite[] = [];
  for (const row of rows as any[]) {
    const site = mappedSiteFromRow(row);
    if (site) sites.push(site);
  }
  return sites;
}
