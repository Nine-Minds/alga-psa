import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getAdminConnection } from '@alga-psa/db/admin';

const outputPath = process.env.IMAP_STATE_OUTPUT;
const tenantId = process.env.TENANT_ID;
const providerId = process.env.PROVIDER_ID;
const expectedDatabase = process.env.DB_NAME_SERVER;
if (!outputPath || !tenantId || !providerId || !expectedDatabase) {
  throw new Error('IMAP state snapshot requires output path, tenant, provider, and database');
}

const db = await getAdminConnection();
try {
  const [{ database }] = await db.raw('select current_database() as database').then((result: any) => result.rows);
  if (database !== expectedDatabase) throw new Error('Database connection does not match DB_NAME_SERVER');

  const row = await db('imap_email_provider_config')
    .where({ tenant: tenantId, email_provider_id: providerId })
    .first(
      'host', 'port', 'secure', 'allow_starttls', 'username', 'auth_type',
      'oauth_token_url', 'oauth_authorize_url', 'oauth_client_id',
      'oauth_client_secret', 'credential_generation', 'updated_at',
    );
  if (!row) throw new Error('Provider state row was not found in the isolated database');
  if (typeof row.credential_generation !== 'string' || row.credential_generation.length === 0) {
    throw new Error('Persisted provider has no credential generation');
  }
  const updatedAt = new Date(row.updated_at).toISOString();

  const identity = {
    host: row.host,
    port: Number(row.port),
    secure: Boolean(row.secure ?? true),
    allowStarttls: Boolean(row.allow_starttls ?? false),
    username: row.username ?? null,
    authType: row.auth_type ?? null,
    oauthTokenUrl: row.oauth_token_url ?? null,
    oauthAuthorizeUrl: row.oauth_authorize_url ?? null,
    oauthClientId: row.oauth_client_id ?? null,
    oauthClientSecretPresent: typeof row.oauth_client_secret === 'string' && row.oauth_client_secret.length > 0,
  };
  const state = {
    database,
    providerId,
    host: identity.host,
    port: identity.port,
    authType: identity.authType,
    oauthClientId: identity.oauthClientId,
    credentialGeneration: row.credential_generation,
    scopeFingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    updatedAt,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
} finally {
  await db.destroy();
}
