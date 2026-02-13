import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TacticalRmmClient, normalizeTacticalBaseUrl } from './tacticalApiClient';
import { computeTacticalAgentStatus } from './agentStatus';

const PROVIDER = 'tacticalrmm' as const;

const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';

function extractOsFields(agent: any): { os_type: string | null; os_version: string | null } {
  const raw = String(agent?.operating_system || agent?.os || agent?.os_name || '').trim();
  if (!raw) return { os_type: null, os_version: null };
  const parts = raw.split(/\s+/);
  const os_type = parts[0] || raw;
  const os_version = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { os_type, os_version };
}

function extractVitals(agent: any): {
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

export async function syncTacticalSingleAgentForTenant(args: {
  tenant: string;
  agentId: string;
}): Promise<{ updated: boolean; assetId: string | null }> {
  const agentId = String(args.agentId || '').trim();
  if (!agentId) return { updated: false, assetId: null };

  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  const integration = await knex('rmm_integrations')
    .where({ tenant: args.tenant, provider: PROVIDER })
    .first(['instance_url', 'settings']);

  const authMode = (integration?.settings?.auth_mode as 'api_key' | 'knox' | undefined) || 'api_key';
  const instanceUrl = normalizeTacticalBaseUrl(String(integration?.instance_url || '').trim());
  if (!instanceUrl) return { updated: false, assetId: null };

  let client: TacticalRmmClient;
  if (authMode === 'api_key') {
    const apiKey = await secretProvider.getTenantSecret(args.tenant, TACTICAL_API_KEY_SECRET);
    client = new TacticalRmmClient({ baseUrl: instanceUrl, authMode: 'api_key', apiKey: apiKey || undefined });
  } else {
    const token = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET);
    const username = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_USERNAME_SECRET);
    const password = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_PASSWORD_SECRET);

    client = new TacticalRmmClient({
      baseUrl: instanceUrl,
      authMode: 'knox',
      knoxToken: token || undefined,
      refreshKnoxToken: async () => {
        if (!username || !password) throw new Error('Knox username/password not configured');
        const unauth = new TacticalRmmClient({ baseUrl: instanceUrl, authMode: 'knox' });
        const { totp } = await unauth.checkCreds({ username, password });
        if (totp) throw new Error('TOTP required to refresh Knox token');
        const login = await unauth.login({ username, password });
        await secretProvider.setTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET, login.token);
        return login.token;
      },
    });
  }

  const agent = await client.request<any>({
    method: 'GET',
    path: `/api/beta/v1/agent/${encodeURIComponent(agentId)}/`,
  });

  const mapping = await knex('tenant_external_entity_mappings')
    .where({
      tenant: args.tenant,
      integration_type: PROVIDER,
      alga_entity_type: 'asset',
      external_entity_id: agentId,
    })
    .first(['id', 'alga_entity_id', 'external_realm_id']);

  if (!mapping?.alga_entity_id) return { updated: false, assetId: null };

  const assetIdText = String(mapping.alga_entity_id);
  const externalOrgId = String(agent?.client_id ?? agent?.client ?? mapping.external_realm_id ?? '');

  const lastSeen = agent?.last_seen || agent?.lastSeen || null;
  const status = computeTacticalAgentStatus({
    lastSeen,
    offlineTimeMinutes: agent?.offline_time ?? agent?.offlineTime ?? null,
    overdueTimeMinutes: agent?.overdue_time ?? agent?.overdueTime ?? null,
  });

  const deviceName = String(agent?.hostname || agent?.name || agent?.computer_name || agentId);
  const osFields = extractOsFields(agent);
  const vitals = extractVitals(agent);
  const agentVersion = agent?.agent_version ?? agent?.version ?? null;

  const assetRow = await knex('assets')
    .where({ tenant: args.tenant })
    .whereRaw('assets.asset_id::text = ?', [assetIdText])
    .first(['asset_type']);

  await knex('assets')
    .where({ tenant: args.tenant })
    .whereRaw('assets.asset_id::text = ?', [assetIdText])
    .update({
      name: deviceName,
      rmm_provider: PROVIDER,
      rmm_device_id: agentId,
      rmm_organization_id: externalOrgId || null,
      agent_status: status,
      last_seen_at: lastSeen ? new Date(lastSeen) : null,
      last_rmm_sync_at: knex.fn.now(),
    });

  const extensionTable = assetRow?.asset_type === 'server' ? 'server_assets' : 'workstation_assets';
  await knex(extensionTable)
    .insert({
      tenant: args.tenant,
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

  await knex('tenant_external_entity_mappings')
    .where({ tenant: args.tenant, id: mapping.id })
    .update({
      external_realm_id: externalOrgId || mapping.external_realm_id,
      sync_status: 'synced',
      last_synced_at: knex.fn.now(),
      metadata: { raw: agent },
    });

  return { updated: true, assetId: assetIdText };
}

