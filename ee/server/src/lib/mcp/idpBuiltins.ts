import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { discoverOidc } from './oidcDiscovery';

/**
 * Hosted built-in trusted IdPs (Tier 2, F010-F014). On SaaS, Nine Minds runs
 * shared Google + multi-tenant Microsoft OAuth apps (the same ones used for SSO).
 * When those shared app credentials are present we pre-trust Google + Microsoft
 * issuers, so a hosted tenant can provision agents without registering an IdP.
 * Token validation reuses the same jose pipeline as agent_idp_providers rows.
 */

const GOOGLE_ISSUER = 'https://accounts.google.com';
// A concrete Entra tenant issuer (multi-tenant tokens carry the customer's tid).
const MICROSOFT_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F-]{8,}\/v2\.0$/;

async function appSecret(name: string): Promise<string> {
  try {
    const sp = await getSecretProviderInstance();
    return (await sp.getAppSecret(name)) || '';
  } catch {
    return '';
  }
}

export async function hostedGoogleEnabled(): Promise<boolean> {
  return Boolean((await appSecret('GOOGLE_OAUTH_CLIENT_ID')) || process.env.GOOGLE_OAUTH_CLIENT_ID);
}
export async function hostedMicrosoftEnabled(): Promise<boolean> {
  return Boolean((await appSecret('MICROSOFT_OAUTH_CLIENT_ID')) || process.env.MICROSOFT_OAUTH_CLIENT_ID);
}

export interface BuiltinIdpConfig {
  jwksUri: string;
  audience: string | null;
  subjectClaim: string;
}

/** If `issuer` is a pre-trusted hosted Google/Microsoft issuer, return its validation config. */
export async function getBuiltinIdpForIssuer(issuer: string): Promise<BuiltinIdpConfig | null> {
  if (issuer === GOOGLE_ISSUER && (await hostedGoogleEnabled())) {
    const cfg = await discoverOidc(`${GOOGLE_ISSUER}/.well-known/openid-configuration`);
    const aud = (await appSecret('GOOGLE_OAUTH_CLIENT_ID')) || process.env.GOOGLE_OAUTH_CLIENT_ID || null;
    return { jwksUri: cfg.jwksUri, audience: aud, subjectClaim: 'sub' };
  }
  if (MICROSOFT_ISSUER_RE.test(issuer) && (await hostedMicrosoftEnabled())) {
    const cfg = await discoverOidc(`${issuer}/.well-known/openid-configuration`);
    const aud = (await appSecret('MICROSOFT_OAUTH_CLIENT_ID')) || process.env.MICROSOFT_OAUTH_CLIENT_ID || null;
    return { jwksUri: cfg.jwksUri, audience: aud, subjectClaim: 'azp' };
  }
  return null;
}

/** Built-in issuers to advertise in Protected Resource Metadata (hosted). */
export async function listBuiltinIssuers(): Promise<string[]> {
  const out: string[] = [];
  if (await hostedGoogleEnabled()) out.push(GOOGLE_ISSUER);
  if (await hostedMicrosoftEnabled()) out.push('https://login.microsoftonline.com/organizations/v2.0');
  return out;
}
