import { discoverOidc } from './oidcDiscovery';

/**
 * Agent-IdP provider presets (F003). "google" and "microsoft" remove the raw
 * issuer/JWKS friction by deriving the issuer + discovering the JWKS; "custom"
 * keeps the Phase-2 raw entry. Mirrors how SSO offers named providers.
 */
export type IdpKind = 'google' | 'microsoft' | 'custom';

export interface ResolvedIdp {
  issuer: string;
  jwksUri: string;
  subjectClaim: string;
}

export interface PresetInput {
  entraTenantId?: string;
  issuer?: string;
  jwksUri?: string;
  subjectClaim?: string;
  /** Override the discovery origin (tests / mock IdP). */
  discoveryBaseUrl?: string;
}

const GOOGLE_DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';
const MICROSOFT_BASE = 'https://login.microsoftonline.com';

export function microsoftDiscoveryUrl(entraTenantId: string, base = MICROSOFT_BASE): string {
  return `${base}/${encodeURIComponent(entraTenantId)}/v2.0/.well-known/openid-configuration`;
}

export async function resolveIdpFromPreset(kind: IdpKind, input: PresetInput = {}): Promise<ResolvedIdp> {
  if (kind === 'google') {
    const url = input.discoveryBaseUrl
      ? `${input.discoveryBaseUrl.replace(/\/$/, '')}/.well-known/openid-configuration`
      : GOOGLE_DISCOVERY;
    const c = await discoverOidc(url);
    // Google service-account tokens identify the account in `sub`.
    return { issuer: c.issuer, jwksUri: c.jwksUri, subjectClaim: input.subjectClaim || 'sub' };
  }

  if (kind === 'microsoft') {
    const tid = (input.entraTenantId || '').trim();
    const url = input.discoveryBaseUrl
      ? `${input.discoveryBaseUrl.replace(/\/$/, '')}/.well-known/openid-configuration`
      : (() => {
          if (!tid) throw new Error('The Microsoft preset requires an Entra tenant id.');
          return microsoftDiscoveryUrl(tid);
        })();
    const c = await discoverOidc(url);
    // Entra app-only tokens identify the app in `azp`/`appid`; user tokens use `oid`/`sub`.
    return { issuer: c.issuer, jwksUri: c.jwksUri, subjectClaim: input.subjectClaim || 'azp' };
  }

  // custom
  if (!input.issuer || !input.jwksUri) {
    throw new Error('A custom IdP requires both issuer and jwksUri.');
  }
  return { issuer: input.issuer, jwksUri: input.jwksUri, subjectClaim: input.subjectClaim || 'sub' };
}
