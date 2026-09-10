import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TacticalRmmClient, normalizeTacticalBaseUrl } from './tacticalApiClient';
import { computeTacticalAgentStatus } from './agentStatus';
import { buildTacticalExtensionPatch, extractHardware, upsertTacticalAssetExtension } from './deviceSync';

const PROVIDER = 'tacticalrmm' as const;

const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';

export async function syncTacticalSingleAgentForTenant(args: {
  tenant: string;
  agentId: string;
}): Promise<{ updated: boolean; assetId: string | null }> {
  const tenant = String(args.tenant || '').trim();
  if (!tenant) return { updated: false, assetId: null };

  const agentId = String(args.agentId || '').trim();
  if (!agentId) return { updated: false, assetId: null };

  const { knex } = await createTenantKnex();
  const scopedDb = tenantDb(knex, tenant);
  const secretProvider = await getSecretProviderInstance();

  const integration = await scopedDb.table('rmm_integrations')
    .where({ provider: PROVIDER })
    .first(['instance_url', 'settings']);

  const authMode = (integration?.settings?.auth_mode as 'api_key' | 'knox' | undefined) || 'api_key';
  const instanceUrl = normalizeTacticalBaseUrl(String(integration?.instance_url || '').trim());
  if (!instanceUrl) return { updated: false, assetId: null };

  let client: TacticalRmmClient;
  if (authMode === 'api_key') {
    const apiKey = await secretProvider.getTenantSecret(tenant, TACTICAL_API_KEY_SECRET);
    client = new TacticalRmmClient({ baseUrl: instanceUrl, authMode: 'api_key', apiKey: apiKey || undefined });
  } else {
    const token = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET);
    const username = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET);
    const password = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET);

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
        await secretProvider.setTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET, login.token);
        return login.token;
      },
    });
  }

  const agent = await client.request<any>({
    method: 'GET',
    path: `/beta/v1/agent/${encodeURIComponent(agentId)}/`,
  });

  const mapping = await scopedDb.table('tenant_external_entity_mappings')
    .where({
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
  const extensionPatch = buildTacticalExtensionPatch(agent);
  const hardware = extractHardware(agent);

  const assetRow = await scopedDb.table('assets')
    .whereRaw('assets.asset_id::text = ?', [assetIdText])
    .first(['asset_type']);

  await scopedDb.table('assets')
    .whereRaw('assets.asset_id::text = ?', [assetIdText])
    .update({
      name: deviceName,
      rmm_provider: PROVIDER,
      rmm_device_id: agentId,
      rmm_organization_id: externalOrgId || null,
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

  await scopedDb.table('tenant_external_entity_mappings')
    .where({ id: mapping.id })
    .update({
      external_realm_id: externalOrgId || mapping.external_realm_id,
      sync_status: 'synced',
      last_synced_at: knex.fn.now(),
      metadata: { raw: agent },
    });

  return { updated: true, assetId: assetIdText };
}
