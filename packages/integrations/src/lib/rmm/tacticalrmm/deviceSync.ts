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

function isTacticalPosix(agent: any): boolean {
  const plat = String(agent?.plat ?? '').toLowerCase();
  return plat === 'linux' || plat === 'darwin';
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function firstIpv4(candidates: unknown[]): string | null {
  for (const c of candidates) {
    const ip = String(c ?? '').trim();
    if (IPV4_RE.test(ip)) return ip;
  }
  return null;
}

/**
 * LAN IP from what Tactical actually sends. The detail endpoint exposes
 * `local_ips` (a comma-joined string, or an error sentinel); the list endpoint
 * only carries the raw `wmi_detail` the property is derived from.
 */
function extractTacticalLanIp(agent: any): string | null {
  const direct = agent?.lan_ip ?? agent?.local_ip ?? agent?.ip_address ?? null;
  if (direct) return String(direct);

  if (typeof agent?.local_ips === 'string') {
    const ip = firstIpv4(agent.local_ips.split(','));
    if (ip) return ip;
  }

  const wmi = agent?.wmi_detail;
  if (!wmi || typeof wmi !== 'object') return null;

  if (isTacticalPosix(agent)) {
    return Array.isArray(wmi.local_ips) ? firstIpv4(wmi.local_ips) : null;
  }

  const configs = Array.isArray(wmi.network_config) ? wmi.network_config : [];
  for (const cfg of configs) {
    const entries = Array.isArray(cfg) ? cfg : [cfg];
    for (const entry of entries) {
      const addrs = entry && typeof entry === 'object' ? (entry as any).IPAddress : null;
      const ip = firstIpv4(Array.isArray(addrs) ? addrs : [addrs]);
      if (ip) return ip;
    }
  }
  return null;
}

function bootTimeToDate(agent: any): Date | null {
  const raw = agent?.boot_time ?? agent?.bootTime ?? null;
  if (raw === null || typeof raw === 'undefined' || raw === '') return null;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return new Date(secs * 1000);
}

export function extractVitals(agent: any, now: Date = new Date()): {
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

  let uptimeSeconds = uptimeRaw === null || typeof uptimeRaw === 'undefined'
    ? null
    : Number(uptimeRaw);

  // Tactical reports boot_time (epoch seconds) rather than an uptime.
  if (!Number.isFinite(uptimeSeconds as any)) {
    const booted = bootTimeToDate(agent);
    uptimeSeconds = booted ? Math.max(0, Math.floor((now.getTime() - booted.getTime()) / 1000)) : null;
  }

  const wanIp =
    agent?.wan_ip ??
    agent?.public_ip ??
    agent?.publicIp ??
    null;

  return {
    current_user: currentUser ? String(currentUser) : null,
    uptime_seconds: Number.isFinite(uptimeSeconds as any) ? uptimeSeconds : null,
    lan_ip: extractTacticalLanIp(agent),
    wan_ip: wanIp ? String(wanIp) : null,
  };
}

const BYTE_UNIT_TO_GB: Record<string, number> = {
  b: 1e-9,
  kb: 1e-6,
  mb: 1e-3,
  gb: 1,
  tb: 1e3,
  pb: 1e6,
};

/** Tactical's agent formats disk sizes with ByteCountSI ("476.9 GB"); older payloads carry raw bytes. */
export function parseTacticalSizeToGb(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round((value / 1e9) * 10) / 10 : null;
  }
  const m = String(value ?? '').trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const factor = BYTE_UNIT_TO_GB[m[2].toLowerCase()];
  if (!Number.isFinite(n) || factor === undefined) return null;
  return Math.round(n * factor * 10) / 10;
}

export interface TacticalHardware {
  cpu_model: string | null;
  cpu_cores: number | null;
  ram_gb: number | null;
  disk_usage: Array<{ name: string; total_gb: number; free_gb: number; utilization_percent: number }> | null;
  serial_number: string | null;
  last_reboot_at: Date | null;
}

/**
 * Hardware facts from either Tactical payload shape. The list endpoint
 * (/beta/v1/agent/) serializes model fields only, so cpu_model, serial_number
 * and local_ips — properties derived from wmi_detail — arrive only from the
 * detail endpoint. Both shapes are read so bulk and single-agent syncs land
 * the same columns.
 */
export function extractHardware(agent: any): TacticalHardware {
  const wmi = agent?.wmi_detail && typeof agent.wmi_detail === 'object' ? agent.wmi_detail : null;
  const posix = isTacticalPosix(agent);

  let cpuModel: string | null = null;
  let cpuCores: number | null = null;

  if (Array.isArray(agent?.cpu_model) && agent.cpu_model.length) {
    const names: string[] = agent.cpu_model.map((c: unknown) => String(c ?? '').trim()).filter(Boolean);
    cpuModel = names.length ? names.join(', ') : null;
    const cores = names.reduce((sum, n) => sum + Number(n.match(/,\s*(\d+)C\/\d+T$/)?.[1] ?? 0), 0);
    cpuCores = cores > 0 ? cores : null;
  } else if (wmi) {
    if (posix) {
      const cpus: string[] = Array.isArray(wmi.cpus)
        ? wmi.cpus.map((c: unknown) => String(c ?? '').trim()).filter(Boolean)
        : [];
      cpuModel = cpus.length ? cpus.join(', ') : null;
    } else {
      const names: string[] = [];
      let cores = 0;
      for (const cpu of Array.isArray(wmi.cpu) ? wmi.cpu : []) {
        const entries: any[] = Array.isArray(cpu) ? cpu : [cpu];
        const name = entries.find((x) => x && typeof x === 'object' && 'Name' in x)?.Name;
        const nc = entries.find((x) => x && typeof x === 'object' && 'NumberOfCores' in x)?.NumberOfCores;
        if (name) names.push(String(name).trim());
        if (Number.isFinite(Number(nc))) cores += Number(nc);
      }
      cpuModel = names.length ? names.join(', ') : null;
      cpuCores = cores > 0 ? cores : null;
    }
  }

  if (cpuModel && /^unknown cpu model$/i.test(cpuModel)) cpuModel = null;
  if (cpuModel && cpuModel.length > 255) cpuModel = cpuModel.slice(0, 255);

  const ramRaw = agent?.total_ram ?? agent?.ram_gb ?? null;
  const ram = ramRaw === null || typeof ramRaw === 'undefined' ? NaN : Number(ramRaw);
  const ramGb = Number.isFinite(ram) && ram > 0 ? Math.round(ram) : null;

  let diskUsage: TacticalHardware['disk_usage'] = null;
  if (Array.isArray(agent?.disks)) {
    diskUsage = [];
    for (const d of agent.disks) {
      const total = parseTacticalSizeToGb(d?.total);
      if (total === null) continue;
      const free = parseTacticalSizeToGb(d?.free);
      const percent = Number(d?.percent);
      diskUsage.push({
        name: String(d?.device ?? d?.mountpoint ?? d?.name ?? '').trim() || 'disk',
        total_gb: total,
        free_gb: free ?? 0,
        utilization_percent: Number.isFinite(percent)
          ? Math.round(percent)
          : free !== null && total > 0
            ? Math.round(((total - free) / total) * 100)
            : 0,
      });
    }
  }

  let serial: string | null = null;
  const direct = agent?.serial_number ?? agent?.serial;
  if (typeof direct === 'string' && direct.trim()) {
    serial = direct.trim();
  } else if (wmi) {
    const raw = posix
      ? wmi.serialnumber
      : wmi.bios?.[0]?.[0]?.SerialNumber ?? wmi.bios?.[0]?.SerialNumber;
    serial = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  return {
    cpu_model: cpuModel,
    cpu_cores: cpuCores,
    ram_gb: ramGb,
    disk_usage: diskUsage,
    serial_number: serial,
    last_reboot_at: bootTimeToDate(agent),
  };
}

/**
 * Column patch for workstation_assets / server_assets. Hardware keys are only
 * included when the payload actually carried them, so a thinner payload never
 * blanks a column a richer one filled.
 */
export function buildTacticalExtensionPatch(agent: any, now: Date = new Date()): Record<string, unknown> {
  const osFields = extractOsFields(agent);
  const vitals = extractVitals(agent, now);
  const hardware = extractHardware(agent);
  const agentVersion = agent?.agent_version ?? agent?.version ?? null;

  const patch: Record<string, unknown> = {
    os_type: osFields.os_type,
    os_version: osFields.os_version,
    agent_version: agentVersion ? String(agentVersion) : null,
    current_user: vitals.current_user,
    uptime_seconds: vitals.uptime_seconds,
    lan_ip: vitals.lan_ip,
    wan_ip: vitals.wan_ip,
  };

  if (hardware.cpu_model !== null) patch.cpu_model = hardware.cpu_model;
  if (hardware.cpu_cores !== null) patch.cpu_cores = hardware.cpu_cores;
  if (hardware.ram_gb !== null) patch.ram_gb = hardware.ram_gb;
  if (hardware.disk_usage !== null) patch.disk_usage = JSON.stringify(hardware.disk_usage);
  if (hardware.last_reboot_at !== null) patch.last_reboot_at = hardware.last_reboot_at;

  return patch;
}

export async function upsertTacticalAssetExtension(
  conn: Knex | Knex.Transaction,
  args: { tenant: string; assetType: string | null | undefined; assetId: string; patch: Record<string, unknown> }
): Promise<void> {
  const table = args.assetType === 'server' ? 'server_assets' : 'workstation_assets';
  await tenantScopedTable(conn, table, args.tenant)
    .insert({
      tenant: args.tenant,
      asset_id: conn.raw('?::uuid', [args.assetId]),
      ...args.patch,
    })
    .onConflict(['tenant', 'asset_id'])
    .merge(args.patch);
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
          const extensionPatch = buildTacticalExtensionPatch(agent);
          const hardware = extractHardware(agent);

          if (!mapping?.alga_entity_id) {
            const assetType = inferAssetTypeFromTacticalAgent(agent);
            const asset = await createTacticalAssetRecord(knex, {
              tenant,
              clientId: algaClientId,
              assetType,
              assetTag: `tactical:${agentId}`,
              name: deviceName,
              serialNumber: hardware.serial_number ?? '',
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

            await upsertTacticalAssetExtension(knex, {
              tenant,
              assetType,
              assetId: String(asset.asset_id),
              patch: extensionPatch,
            });

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
                ...(hardware.serial_number ? { serial_number: hardware.serial_number } : {}),
              });

            await upsertTacticalAssetExtension(knex, {
              tenant,
              assetType: assetRow?.asset_type,
              assetId: assetIdText,
              patch: extensionPatch,
            });

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
