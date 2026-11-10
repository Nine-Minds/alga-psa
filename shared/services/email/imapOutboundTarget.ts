import { createHash } from 'node:crypto';
import process from 'node:process';
import {
  assertSafeOutboundTarget,
  parseOutboundTargetAllowlist,
} from '@alga-psa/shared/lib/net/outboundTarget';

export async function assertSafeImapHost(host: string): Promise<void> {
  const value = host.trim();
  const urlHost = value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
  await assertSafeOutboundTarget(`imap://${urlHost}/`, {
    schemes: ['imap'],
    privateTargetAllowlist: parseOutboundTargetAllowlist(
      process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST
    ),
  });
}

export async function assertSafeImapOauthTokenEndpoint(endpoint: string): Promise<void> {
  await assertSafeOutboundTarget(endpoint, { schemes: ['https'] });
}

export function isImapOauthCredentialIssuerBound(provider: {
  oauth_token_url?: string | null;
  oauth_credentials_token_url?: string | null;
}): boolean {
  return Boolean(provider.oauth_token_url && provider.oauth_credentials_token_url === provider.oauth_token_url);
}

export function assertImapOauthCredentialIssuerBound(provider: {
  oauth_token_url?: string | null;
  oauth_credentials_token_url?: string | null;
}): void {
  if (!isImapOauthCredentialIssuerBound(provider)) {
    throw new Error('IMAP OAuth credentials must be reauthorized for the configured token endpoint');
  }
}
export function getImapOauthSecretNames(provider: {
  id?: string;
  email_provider_id?: string;
  oauth_token_url?: string | null;
  oauth_credentials_secret_version?: number | null;
}): { clientSecret: string; refreshToken: string } {
  const providerId = provider.id ?? provider.email_provider_id;
  if (!providerId) throw new Error('IMAP provider ID is required to resolve OAuth secret names');
  if (Number(provider.oauth_credentials_secret_version || 0) < 1 || !provider.oauth_token_url) {
    return {
      clientSecret: `imap_oauth_client_secret_${providerId}`,
      refreshToken: `imap_refresh_token_${providerId}`,
    };
  }
  const legacyBase = `imap_oauth_legacy_${providerId}`;
  const endpointHash = createHash('sha256').update(provider.oauth_token_url).digest('hex').slice(0, 24);
  return {
    clientSecret: `${legacyBase}_${endpointHash}_client_secret`,
    refreshToken: `${legacyBase}_${endpointHash}_refresh_token`,
  };
}
