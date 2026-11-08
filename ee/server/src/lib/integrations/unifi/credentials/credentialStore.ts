/**
 * Persistence for UniFi credentials and console routes.
 *
 * Rows live in unifi_credentials / unifi_console_routes. Key material lives only
 * in the secret provider, one secret per credential:
 *   unifi_api_key:<credential_id>
 *   unifi_local_base_url:<credential_id>      (local mode)
 * The legacy unnamed secrets (`unifi_api_key`, `unifi_local_base_url`) are read
 * only to adopt them into a backfilled credential, or when a tenant has zero
 * credential rows (staggered backfill / code deploy).
 */

import type { Knex } from 'knex';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { randomUUID } from 'node:crypto';
import {
  type UniFiConsoleRoute,
  type UniFiCredentialMode,
  type UniFiCredentialRecord,
  type UniFiCredentialSecrets,
  type UniFiCredentialStatus,
  type UniFiFleetStore,
  type UniFiRouteState,
} from './types';

const PROVIDER = 'unifi';
// LEVERAGE: pattern per-entity-secret-names — <thing>:<id> secret naming plus legacy-name fallback; a generic keyed-secret helper would serve other multi-credential integrations.
export const LEGACY_API_KEY_SECRET = 'unifi_api_key';
export const LEGACY_LOCAL_BASE_URL_SECRET = 'unifi_local_base_url';
/** Id of the synthetic credential built from legacy secrets when no rows exist. */
export const LEGACY_CREDENTIAL_ID = 'legacy';
/** Host id of the migrated local credential; keeps every `local:<siteId>` scope key valid. */
export const MIGRATED_LOCAL_HOST_ID = 'local';

export function credentialApiKeySecretName(credentialId: string): string {
  return `${LEGACY_API_KEY_SECRET}:${credentialId}`;
}

export function credentialLocalUrlSecretName(credentialId: string): string {
  return `${LEGACY_LOCAL_BASE_URL_SECRET}:${credentialId}`;
}

/**
 * Local host ids are embedded in scope keys (`<hostId>:<siteId>`) and
 * parseUniFiScopeKey splits on the first colon, so an id must never contain one.
 * 'local' is reserved for the migrated credential.
 */
export function nextLocalHostId(existing: Array<string | null | undefined>): string {
  const taken = new Set(existing.filter((value): value is string => Boolean(value)));
  for (let n = 2; ; n += 1) {
    const candidate = `local-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function rowToCredential(row: any): UniFiCredentialRecord {
  return {
    credentialId: String(row.credential_id),
    integrationId: String(row.integration_id),
    label: String(row.label),
    mode: row.mode === 'local' ? 'local' : 'site_manager',
    localHostId: row.local_host_id ? String(row.local_host_id) : null,
    status: (row.status as UniFiCredentialStatus) ?? 'active',
    lastError: row.last_error ?? null,
    lastCheckedAt: toDate(row.last_checked_at),
    adoptsLegacySecret: Boolean(row.adopts_legacy_secret),
    createdAt: toDate(row.created_at) ?? new Date(0),
  };
}

function rowToRoute(row: any): UniFiConsoleRoute {
  return {
    hostId: String(row.host_id),
    credentialId: row.credential_id ? String(row.credential_id) : null,
    consoleName: row.console_name ?? null,
    state: row.state === 'unreachable' ? 'unreachable' : 'routed',
    lastError: row.last_error ?? null,
    firstSeenAt: toDate(row.first_seen_at) ?? new Date(0),
    lastVerifiedAt: toDate(row.last_verified_at) ?? new Date(0),
  };
}

export async function findUniFiIntegrationId(knex: Knex, tenant: string): Promise<string | null> {
  const row = await tenantDb(knex, tenant).table('rmm_integrations').where({ provider: PROVIDER }).first('integration_id');
  return row?.integration_id ? String(row.integration_id) : null;
}

export async function listCredentialRecords(
  knex: Knex,
  tenant: string,
  integrationId: string
): Promise<UniFiCredentialRecord[]> {
  const rows = await tenantDb(knex, tenant)
    .table('unifi_credentials')
    .where({ integration_id: integrationId })
    .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'credential_id', order: 'asc' }]);
  return rows.map(rowToCredential);
}

export async function listRouteRecords(knex: Knex, tenant: string, integrationId: string): Promise<UniFiConsoleRoute[]> {
  const rows = await tenantDb(knex, tenant).table('unifi_console_routes').where({ integration_id: integrationId });
  return rows.map(rowToRoute);
}

/**
 * Reads one credential's secrets. A backfilled credential (adopts_legacy_secret)
 * copies the legacy secrets to its per-credential names the first time it is read.
 * Returns null when no key is stored.
 */
export async function readCredentialSecrets(
  knex: Knex,
  tenant: string,
  credential: UniFiCredentialRecord
): Promise<UniFiCredentialSecrets | null> {
  const secretProvider = await getSecretProviderInstance();

  if (credential.credentialId === LEGACY_CREDENTIAL_ID) {
    const [apiKey, localBaseUrl] = await Promise.all([
      secretProvider.getTenantSecret(tenant, LEGACY_API_KEY_SECRET),
      secretProvider.getTenantSecret(tenant, LEGACY_LOCAL_BASE_URL_SECRET),
    ]);
    return apiKey ? { apiKey, localBaseUrl: localBaseUrl || null } : null;
  }

  let [apiKey, localBaseUrl] = await Promise.all([
    secretProvider.getTenantSecret(tenant, credentialApiKeySecretName(credential.credentialId)),
    credential.mode === 'local'
      ? secretProvider.getTenantSecret(tenant, credentialLocalUrlSecretName(credential.credentialId))
      : Promise.resolve(undefined),
  ]);

  if (!apiKey && credential.adoptsLegacySecret) {
    const [legacyKey, legacyUrl] = await Promise.all([
      secretProvider.getTenantSecret(tenant, LEGACY_API_KEY_SECRET),
      credential.mode === 'local'
        ? secretProvider.getTenantSecret(tenant, LEGACY_LOCAL_BASE_URL_SECRET)
        : Promise.resolve(undefined),
    ]);
    if (legacyKey) {
      apiKey = legacyKey;
      localBaseUrl = legacyUrl || undefined;
      try {
        await secretProvider.setTenantSecret(tenant, credentialApiKeySecretName(credential.credentialId), legacyKey);
        if (credential.mode === 'local' && legacyUrl) {
          await secretProvider.setTenantSecret(tenant, credentialLocalUrlSecretName(credential.credentialId), legacyUrl);
        }
        await tenantDb(knex, tenant)
          .table('unifi_credentials')
          .where({ credential_id: credential.credentialId })
          .update({ adopts_legacy_secret: false, updated_at: knex.fn.now() });
      } catch {
        // Adoption is retried on the next read; the legacy secret still works meanwhile.
      }
    }
  }

  return apiKey ? { apiKey, localBaseUrl: localBaseUrl || null } : null;
}

export async function writeCredentialSecrets(
  tenant: string,
  credentialId: string,
  secrets: { apiKey?: string; localBaseUrl?: string | null }
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  if (secrets.apiKey) {
    await secretProvider.setTenantSecret(tenant, credentialApiKeySecretName(credentialId), secrets.apiKey);
  }
  if (typeof secrets.localBaseUrl === 'string') {
    await secretProvider.setTenantSecret(tenant, credentialLocalUrlSecretName(credentialId), secrets.localBaseUrl);
  } else if (secrets.localBaseUrl === null) {
    await secretProvider.deleteTenantSecret(tenant, credentialLocalUrlSecretName(credentialId));
  }
}

export async function deleteCredentialSecrets(tenant: string, credentialId: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await Promise.all([
    secretProvider.deleteTenantSecret(tenant, credentialApiKeySecretName(credentialId)),
    secretProvider.deleteTenantSecret(tenant, credentialLocalUrlSecretName(credentialId)),
  ]);
}

export async function insertCredential(
  knex: Knex,
  tenant: string,
  input: {
    integrationId: string;
    label: string;
    mode: UniFiCredentialMode;
    localHostId: string | null;
    credentialId?: string;
  }
): Promise<UniFiCredentialRecord> {
  const credentialId = input.credentialId ?? randomUUID();
  const [row] = await tenantDb(knex, tenant)
    .table('unifi_credentials')
    .insert({
      tenant,
      credential_id: credentialId,
      integration_id: input.integrationId,
      label: input.label,
      mode: input.mode,
      local_host_id: input.localHostId,
      status: 'active',
      adopts_legacy_secret: false,
    })
    .returning('*');
  return rowToCredential(row);
}

export async function updateCredentialRow(
  knex: Knex,
  tenant: string,
  credentialId: string,
  patch: Partial<{
    label: string;
    mode: UniFiCredentialMode;
    localHostId: string | null;
    status: UniFiCredentialStatus;
    lastError: string | null;
    lastCheckedAt: Date | null;
  }>
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: knex.fn.now() };
  if (typeof patch.label !== 'undefined') update.label = patch.label;
  if (typeof patch.mode !== 'undefined') update.mode = patch.mode;
  if (typeof patch.localHostId !== 'undefined') update.local_host_id = patch.localHostId;
  if (typeof patch.status !== 'undefined') update.status = patch.status;
  if (typeof patch.lastError !== 'undefined') update.last_error = patch.lastError;
  if (typeof patch.lastCheckedAt !== 'undefined') update.last_checked_at = patch.lastCheckedAt;
  await tenantDb(knex, tenant).table('unifi_credentials').where({ credential_id: credentialId }).update(update);
}

export async function deleteCredentialRow(knex: Knex, tenant: string, credentialId: string): Promise<void> {
  // Routes owned by the credential go with it (FK cascade). Where the FK is not
  // enforced (mixed Citus topology) delete them explicitly as well.
  const db = tenantDb(knex, tenant);
  await db.table('unifi_console_routes').where({ credential_id: credentialId }).delete();
  await db.table('unifi_credentials').where({ credential_id: credentialId }).delete();
}

/** Drops every persisted route of the integration (manual "Re-check all keys", which re-discovers at once). */
export async function clearRoutes(knex: Knex, tenant: string, integrationId: string): Promise<void> {
  await tenantDb(knex, tenant).table('unifi_console_routes').where({ integration_id: integrationId }).delete();
}

/** The epoch: a route verified "then" is never inside the trust window, so the next call re-probes it. */
const STALE_VERIFIED_AT = new Date(0);

/**
 * Withdraws trust from routes without forgetting them (key added, replaced or
 * removed). The next call per console re-probes, but until a probe settles it the
 * row keeps its console name, and an unreachable console keeps its "add a key
 * created under its fabric" warning instead of silently disappearing.
 */
export async function markRoutesStale(
  knex: Knex,
  tenant: string,
  integrationId: string,
  scope: { credentialId: string } | { state: 'unreachable' }
): Promise<void> {
  const query = tenantDb(knex, tenant).table('unifi_console_routes').where({ integration_id: integrationId });
  if ('credentialId' in scope) query.andWhere({ credential_id: scope.credentialId });
  else query.andWhere({ state: scope.state });
  await query.update({ last_verified_at: STALE_VERIFIED_AT });
}

/**
 * Production UniFiFleetStore. `legacyMode` is only consulted when the tenant has
 * zero credential rows: a synthetic credential is then built from the legacy
 * secrets so a staggered backfill/deploy keeps working.
 */
export function createPersistentFleetStore(
  tenant: string,
  options: { knex?: Knex; legacyMode?: UniFiCredentialMode } = {}
): UniFiFleetStore {
  let knexPromise: Promise<Knex> | null = null;
  const getKnex = () => (knexPromise ??= options.knex ? Promise.resolve(options.knex) : getAdminConnection());
  let integrationIdPromise: Promise<string | null> | null = null;
  const getIntegrationId = async () =>
    (integrationIdPromise ??= getKnex().then((knex) => findUniFiIntegrationId(knex, tenant)));

  return {
    async listCredentials() {
      const knex = await getKnex();
      const integrationId = await getIntegrationId();
      if (!integrationId) return [];
      const rows = await listCredentialRecords(knex, tenant, integrationId);
      if (rows.length > 0) return rows;
      const mode = options.legacyMode ?? 'site_manager';
      return [
        {
          credentialId: LEGACY_CREDENTIAL_ID,
          integrationId,
          label: 'Default',
          mode,
          localHostId: mode === 'local' ? MIGRATED_LOCAL_HOST_ID : null,
          status: 'active',
          lastError: null,
          lastCheckedAt: null,
          adoptsLegacySecret: false,
          createdAt: new Date(0),
        },
      ];
    },

    async readSecrets(credential) {
      return readCredentialSecrets(await getKnex(), tenant, credential);
    },

    async loadRoutes() {
      const integrationId = await getIntegrationId();
      if (!integrationId) return [];
      return listRouteRecords(await getKnex(), tenant, integrationId);
    },

    async saveRoute(route) {
      const integrationId = await getIntegrationId();
      if (!integrationId) return;
      const knex = await getKnex();
      // A route may only point at a persisted credential row.
      if (route.credentialId === LEGACY_CREDENTIAL_ID) return;
      await tenantDb(knex, tenant)
        .table('unifi_console_routes')
        .insert({
          tenant,
          integration_id: integrationId,
          host_id: route.hostId,
          credential_id: route.credentialId,
          console_name: route.consoleName,
          state: route.state satisfies UniFiRouteState,
          last_error: route.lastError,
          first_seen_at: knex.fn.now(),
          last_verified_at: knex.fn.now(),
        })
        .onConflict(['tenant', 'integration_id', 'host_id'])
        .merge({
          credential_id: route.credentialId,
          console_name: route.consoleName,
          state: route.state,
          last_error: route.lastError,
          last_verified_at: knex.fn.now(),
        });
    },

    async recordCredentialResult(credentialId, result) {
      if (credentialId === LEGACY_CREDENTIAL_ID) return;
      const knex = await getKnex();
      await updateCredentialRow(knex, tenant, credentialId, {
        ...(result.status ? { status: result.status } : {}),
        lastError: result.lastError,
        lastCheckedAt: new Date(),
      });
    },

    async markIntegrationReconnectRequired() {
      const { markUniFiReconnectRequired } = await import('../reconnect');
      await markUniFiReconnectRequired(tenant);
    },
  };
}
