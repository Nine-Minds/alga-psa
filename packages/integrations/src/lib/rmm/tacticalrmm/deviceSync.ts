/**
 * Tactical RMM bulk device sync, as a callable engine.
 *
 * This lives outside the actions module on purpose: every export from a
 * 'use server' file becomes a callable RPC endpoint, so exporting an
 * unauthenticated sync from there would be a permission-bypass surface. The
 * action keeps the permission check and delegates the work here; the scheduled
 * job calls this directly with no acting user, which the event payload already
 * models as actorType 'SYSTEM'.
 *
 * The helpers below moved here from tacticalRmmActions.ts for the same reason —
 * they are shared by the action and the engine.
 */
import axios, { AxiosError } from 'axios';
import type { Knex } from 'knex';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

import { TacticalRmmClient, normalizeTacticalBaseUrl } from './tacticalApiClient';
import { computeTacticalAgentStatus } from './agentStatus';
import {
  TACTICAL_API_KEY_SECRET,
  TACTICAL_KNOX_PASSWORD_SECRET,
  TACTICAL_KNOX_TOKEN_SECRET,
  TACTICAL_KNOX_USERNAME_SECRET,
  type TacticalRmmAuthMode,
} from './shared';

const PROVIDER = 'tacticalrmm' as const;

export function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder;
}

export async function publishRmmSyncEvent(args: {
  eventType: 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';
  tenantId: string;
  actorUserId?: string;
  integrationId: string;
  syncType: 'organizations' | 'devices' | 'alerts';
  itemsProcessed?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  itemsFailed?: number;
  errorMessage?: string;
}) {
  const payload: Record<string, unknown> = {
    tenantId: args.tenantId,
    occurredAt: new Date().toISOString(),
    actorType: args.actorUserId ? 'USER' : 'SYSTEM',
    actorUserId: args.actorUserId,
    integrationId: args.integrationId,
    provider: PROVIDER,
    syncType: args.syncType,
    itemsProcessed: args.itemsProcessed,
    itemsCreated: args.itemsCreated,
    itemsUpdated: args.itemsUpdated,
    itemsFailed: args.itemsFailed,
    ...(args.eventType === 'RMM_SYNC_FAILED'
      ? { error: { message: args.errorMessage || 'Sync failed' } }
      : {}),
  };

  try {
    await publishEvent({ eventType: args.eventType, payload } as any);
  } catch {
    // Best-effort: never fail the sync on event-publish issues.
  }
}

export function axiosErrorToMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<any>;
    const status = ax.response?.status;
    if (!status) {
      return 'Unable to reach Tactical RMM. Check the instance URL and network access.';
    }
    if (status === 400) {
      return 'Tactical RMM rejected the request. Check the configured URL and credentials.';
    }
    if (status === 401) {
      return 'Tactical RMM credentials are invalid or expired. Reconnect the integration.';
    }
    if (status === 403) {
      return 'Tactical RMM rejected the request because the configured account does not have permission.';
    }
    if (status === 404) {
      return 'Tactical RMM endpoint was not found. Check the instance URL and Beta API access.';
    }
    if (status === 429) {
      return 'Tactical RMM rate limit was reached. Try again later.';
    }
    if (status >= 500) {
      return 'Tactical RMM is temporarily unavailable. Try again later.';
    }
    return `Tactical RMM request failed with status ${status}.`;
  }

  if (err instanceof Error) {
    if (
      err.message === 'Instance URL is not configured' ||
      err.message === 'Knox username/password not configured' ||
      err.message.startsWith('TOTP required')
    ) {
      return err.message;
    }
  }

  return 'Tactical RMM operation failed. Please try again.';
}

export async function buildConfiguredTacticalClient(args: {
  tenant: string;
  instanceUrl: string;
  authMode: TacticalRmmAuthMode;
}) {
  const secretProvider = await getSecretProviderInstance();
  const baseUrl = normalizeTacticalBaseUrl(args.instanceUrl);
  if (!baseUrl) throw new Error('Instance URL is not configured');

  if (args.authMode === 'api_key') {
    const apiKey = await secretProvider.getTenantSecret(args.tenant, TACTICAL_API_KEY_SECRET);
    return new TacticalRmmClient({
      baseUrl,
      authMode: 'api_key',
      apiKey: apiKey || undefined,
    });
  }

  const token = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET);
  const username = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_USERNAME_SECRET);
  const password = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_PASSWORD_SECRET);

  const client = new TacticalRmmClient({
    baseUrl,
    authMode: 'knox',
    knoxToken: token || undefined,
    refreshKnoxToken: async () => {
      if (!username || !password) {
        throw new Error('Knox username/password not configured');
      }
      const unauth = new TacticalRmmClient({ baseUrl, authMode: 'knox' });
      const { totp } = await unauth.checkCreds({ username, password });
      if (totp) {
        throw new Error('TOTP required. Run Test Connection with a TOTP code to save a Knox token.');
      }
      const login = await unauth.login({ username, password });
      return login.token;
    },
    onKnoxTokenRefreshed: async (newToken) => {
      await secretProvider.setTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET, newToken);
    },
  });

  return client;
}

export function inferAssetTypeFromTacticalAgent(agent: any): 'workstation' | 'server' {
  const os = String(agent?.operating_system || agent?.os || agent?.platform || agent?.os_name || '').toLowerCase();
  if (os.includes('server')) return 'server';
  return 'workstation';
}

export function extractOsFields(agent: any): { os_type: string | null; os_version: string | null } {
  const raw = String(agent?.operating_system || agent?.os || agent?.os_name || '').trim();
  if (!raw) return { os_type: null, os_version: null };
  const parts = raw.split(/\s+/);
  const os_type = parts[0] || raw;
  const os_version = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { os_type, os_version };
}

export function extractVitals(agent: any): {
  current_user: string | null;
  uptime_seconds: number | null;
  lan_ip: string | null;
  wan_ip: string | null;
} {
  const currentUser =
    agent?.logged_in_username ??
    agent?.current_user ??
    agent?.currentUser ??
    null;

  const uptimeRaw =
    agent?.uptime_seconds ??
    agent?.uptimeSeconds ??
    agent?.uptime ??
    null;

  const uptimeSeconds = uptimeRaw === null || typeof uptimeRaw === 'undefined'
    ? null
    : Number(uptimeRaw);

  const lanIp =
    agent?.lan_ip ??
    agent?.local_ip ??
    agent?.localIp ??
    agent?.ip_address ??
    null;

  const wanIp =
    agent?.wan_ip ??
    agent?.public_ip ??
    agent?.publicIp ??
    null;

  return {
    current_user: currentUser ? String(currentUser) : null,
    uptime_seconds: Number.isFinite(uptimeSeconds as any) ? uptimeSeconds : null,
    lan_ip: lanIp ? String(lanIp) : null,
    wan_ip: wanIp ? String(wanIp) : null,
  };
}

export async function createTacticalAssetRecord(
  trx: Knex | Knex.Transaction,
  args: {
    tenant: string;
    clientId: string;
    assetType: 'workstation' | 'server';
    assetTag: string;
    name: string;
    serialNumber: string;
    location: string;
  }
): Promise<{ asset_id: string }> {
  const now = new Date().toISOString();
  const [asset] = await tenantScopedTable(trx, 'assets', args.tenant)
    .insert({
      tenant: args.tenant,
      asset_type: args.assetType,
      client_id: args.clientId,
      asset_tag: args.assetTag,
      name: args.name,
      status: 'active',
      location: args.location,
      serial_number: args.serialNumber,
      created_at: now,
      updated_at: now,
    })
    .returning(['asset_id']);

  return { asset_id: String(asset.asset_id) };
}

export interface TacticalDeviceSyncOptions {
  syncType?: 'full' | 'incremental';
  /** Only agents seen at or after this instant are ingested. */
  since?: Date;
}

export interface TacticalDeviceSyncResult {
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_deleted?: number;
  items_failed?: number;
  errors?: string[];
  sync_type?: 'full' | 'incremental';
}

/**
 * Whether an agent falls inside an incremental window.
 *
 * Tactical's /beta/v1/agent/ takes no server-side delta filter — only
 * client_id — so "incremental" is the same page walk with the result filtered
 * on last_seen. Same rule as Level.io: inclusive at the boundary, and an agent
 * with a missing or unparseable last_seen is always considered, so absent data
 * cannot exclude a device from every run forever.
 */
export function tacticalAgentChangedSince(agent: any, since?: Date): boolean {
  if (!since) return true;
  const raw = agent?.last_seen ?? agent?.lastSeen ?? null;
  if (!raw) return true;
  const seen = new Date(raw);
  if (Number.isNaN(seen.getTime())) return true;
  return seen.getTime() >= since.getTime();
}

/**
 * Walks every auto-sync-enabled organization mapping and upserts its agents as
 * assets. Never deletes: an agent missing from the listing is left alone, which
 * is what makes the incremental filter above safe.
 */
export async function runTacticalRmmDeviceSync(
  args: { tenant: string; actorUserId?: string },
  options: TacticalDeviceSyncOptions = {}
): Promise<TacticalDeviceSyncResult> {
  const { tenant, actorUserId } = args;
  const syncType = options.syncType ?? 'full';
  const since = options.since;

  const errors: string[] = [];
  // Used for emitting failure events in the catch block.
  let integrationId: string | undefined;

  try {
    const { knex } = await createTenantKnex();
    const integration = await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    const integrationIdForEvents = String(integration.integration_id);
    integrationId = integrationIdForEvents;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'devices',
    });

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    const mappedOrgs = await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
      .where({ integration_id: integration.integration_id })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']);

    const sites = await client.listAllBeta<any>({ path: '/beta/v1/site/' });
    const siteById = new Map<string, any>();
    for (const s of sites) {
      const id = String((s as any).id ?? (s as any).pk ?? '');
      if (id) siteById.set(id, s);
    }

    let processed = 0;
    let created = 0;
    let updated = 0;

    for (const org of mappedOrgs) {
      const externalOrgId = String((org as any).external_organization_id);
      const algaClientId = String((org as any).client_id);

      const allAgents = await client.listAllBeta<any>({
        path: '/beta/v1/agent/',
        params: { client_id: externalOrgId },
      });
      const agents = allAgents.filter((agent) => tacticalAgentChangedSince(agent, since));

      for (const agent of agents) {
        processed += 1;
        const agentId = String((agent as any).agent_id ?? (agent as any).id ?? (agent as any).pk ?? '');
        try {
          if (!agentId) {
            errors.push(`Agent record missing id (org=${externalOrgId})`);
            continue;
          }

          const siteId = String((agent as any).site_id ?? (agent as any).site ?? '');
          const site = siteId ? siteById.get(siteId) : undefined;
          const siteName = site ? String((site as any).name ?? (site as any).site_name ?? '') : undefined;

          const mapping = await tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant)
            .where({
              integration_type: PROVIDER,
              alga_entity_type: 'asset',
              external_entity_id: agentId,
              external_realm_id: externalOrgId,
            })
            .first(['id', 'alga_entity_id']);

          const lastSeen = (agent as any).last_seen || (agent as any).lastSeen || null;
          const offlineTime = (agent as any).offline_time ?? (agent as any).offlineTime ?? null;
          const overdueTime = (agent as any).overdue_time ?? (agent as any).overdueTime ?? null;
          const status = computeTacticalAgentStatus({
            lastSeen,
            offlineTimeMinutes: offlineTime,
            overdueTimeMinutes: overdueTime,
          });

          const deviceName = String((agent as any).hostname || (agent as any).name || (agent as any).computer_name || agentId);
          const osFields = extractOsFields(agent);
          const agentVersion = (agent as any).agent_version ?? (agent as any).version ?? null;
          const vitals = extractVitals(agent);

          if (!mapping?.alga_entity_id) {
            const assetType = inferAssetTypeFromTacticalAgent(agent);
            const asset = await createTacticalAssetRecord(knex, {
              tenant,
              clientId: algaClientId,
              assetType,
              assetTag: `tactical:${agentId}`,
              name: deviceName,
              serialNumber: String((agent as any).serial_number || (agent as any).serial || ''),
              location: siteName || '',
            });

            await tenantScopedTable(knex, 'assets', tenant)
              .whereRaw('assets.asset_id::text = ?', [String(asset.asset_id)])
              .update({
                rmm_provider: PROVIDER,
                rmm_device_id: agentId,
                rmm_organization_id: externalOrgId,
                agent_status: status,
                last_seen_at: lastSeen ? new Date(lastSeen) : null,
                last_rmm_sync_at: knex.fn.now(),
              });

            if (assetType === 'workstation') {
              await tenantScopedTable(knex, 'workstation_assets', tenant)
                .insert({
                  tenant,
                  asset_id: asset.asset_id,
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            } else {
              await tenantScopedTable(knex, 'server_assets', tenant)
                .insert({
                  tenant,
                  asset_id: asset.asset_id,
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            }

            await tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant).insert({
              tenant,
              integration_type: PROVIDER,
              alga_entity_type: 'asset',
              alga_entity_id: String(asset.asset_id),
              external_entity_id: agentId,
              external_realm_id: externalOrgId,
              sync_status: 'synced',
              last_synced_at: knex.fn.now(),
              metadata: {
                site_id: siteId || undefined,
                site_name: siteName || undefined,
                raw: agent,
              },
            });

            created += 1;
          } else {
            const assetIdText = String(mapping.alga_entity_id);

            const assetRow = await tenantScopedTable(knex, 'assets', tenant)
              .whereRaw('assets.asset_id::text = ?', [assetIdText])
              .first(['asset_type']);

            await tenantScopedTable(knex, 'assets', tenant)
              .whereRaw('assets.asset_id::text = ?', [assetIdText])
              .update({
                name: deviceName,
                rmm_provider: PROVIDER,
                rmm_device_id: agentId,
                rmm_organization_id: externalOrgId,
                agent_status: status,
                last_seen_at: lastSeen ? new Date(lastSeen) : null,
                last_rmm_sync_at: knex.fn.now(),
              });

            if (assetRow?.asset_type === 'server') {
              await tenantScopedTable(knex, 'server_assets', tenant)
                .insert({
                  tenant,
                  asset_id: knex.raw('?::uuid', [assetIdText]),
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            } else {
              await tenantScopedTable(knex, 'workstation_assets', tenant)
                .insert({
                  tenant,
                  asset_id: knex.raw('?::uuid', [assetIdText]),
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            }

            await tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant)
              .where({ id: mapping.id })
              .update({
                external_realm_id: externalOrgId,
                external_entity_id: agentId,
                sync_status: 'synced',
                last_synced_at: knex.fn.now(),
                metadata: {
                  site_id: siteId || undefined,
                  site_name: siteName || undefined,
                  raw: agent,
                },
              });

            updated += 1;
          }
        } catch {
          errors.push(`Failed to sync agent ${agentId}.`);
        }
      }
    }

    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'devices',
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: processed,
      items_created: created,
      items_updated: updated,
      items_deleted: 0,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
      sync_type: syncType,
    };
  } catch (err) {
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'devices',
        errorMessage: axiosErrorToMessage(err),
      });
    }
    return { success: false, error: axiosErrorToMessage(err), sync_type: syncType };
  }
}
