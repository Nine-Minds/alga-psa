import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TacticalRmmClient, normalizeTacticalBaseUrl } from './tacticalApiClient';

const PROVIDER = 'tacticalrmm' as const;

const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';

/**
 * Builds a configured Tactical client from the tenant's stored integration
 * settings and secrets (api_key or knox with token refresh). Returns null
 * when the integration has no usable instance URL.
 */
export async function buildTacticalClientForTenant(tenant: string): Promise<TacticalRmmClient | null> {
  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  const integration = await knex('rmm_integrations')
    .where({ tenant, provider: PROVIDER })
    .first(['instance_url', 'settings']);

  const authMode = (integration?.settings?.auth_mode as 'api_key' | 'knox' | undefined) || 'api_key';
  const instanceUrl = normalizeTacticalBaseUrl(String(integration?.instance_url || '').trim());
  if (!instanceUrl) return null;

  if (authMode === 'api_key') {
    const apiKey = await secretProvider.getTenantSecret(tenant, TACTICAL_API_KEY_SECRET);
    return new TacticalRmmClient({ baseUrl: instanceUrl, authMode: 'api_key', apiKey: apiKey || undefined });
  }

  const token = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET);
  const username = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET);
  const password = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET);

  return new TacticalRmmClient({
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
