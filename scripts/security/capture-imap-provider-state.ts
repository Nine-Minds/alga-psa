import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { getAdminConnection } from '@alga-psa/db/admin';
import { createImapProviderStateSnapshot } from './imap-provider-state-snapshot.mjs';

const outputPath = process.env.IMAP_STATE_OUTPUT;
const tenantId = process.env.TENANT_ID;
const providerId = process.env.PROVIDER_ID;
const expectedDatabase = process.env.DB_NAME_SERVER;
const fingerprintKeyPath = process.env.IMAP_SCOPE_FINGERPRINT_KEY_FILE;
if (!outputPath || !tenantId || !providerId || !expectedDatabase || !fingerprintKeyPath) {
  throw new Error('IMAP state snapshot requires output path, tenant, provider, database, and private fingerprint key');
}

const keyStat = statSync(fingerprintKeyPath);
if (![0o400, 0o600].includes(keyStat.mode & 0o777)) {
  throw new Error('Provider scope fingerprint key file must have mode 400 or 600');
}
const keyText = readFileSync(fingerprintKeyPath, 'utf8').trim();
if (!/^(?:[0-9a-fA-F]{2}){32,}$/.test(keyText)) {
  throw new Error('Provider scope fingerprint key file must contain at least 32 bytes of hexadecimal key material');
}
const fingerprintKey = Buffer.from(keyText, 'hex');

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
  const state = createImapProviderStateSnapshot({ row, database, providerId, fingerprintKey });
  writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
} finally {
  fingerprintKey.fill(0);
  await db.destroy();
}
