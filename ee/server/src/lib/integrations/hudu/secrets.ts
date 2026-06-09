/**
 * Hudu credential resolution.
 *
 * Hudu auth is `x-api-key` + per-instance base URL (NOT OAuth). Credentials are
 * stored per tenant in the secret provider as `hudu_api_key` + `hudu_base_url`,
 * with env-var fallback for development. Mirrors the credential-layering style of
 * ninjaOneClient's resolveNinjaOneClientCredentials (tenant secret -> env).
 *
 * SECURITY: never log the resolved api key. Callers must redact it from errors.
 */

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

/** Secret-provider key names for Hudu credentials (per tenant). */
export const HUDU_SECRET_KEYS = {
  apiKey: 'hudu_api_key',
  baseUrl: 'hudu_base_url',
} as const;

export type HuduSecretKey = (typeof HUDU_SECRET_KEYS)[keyof typeof HUDU_SECRET_KEYS];

/** Env-var fallbacks (development / single-tenant deployments). */
export const HUDU_ENV_VARS = {
  apiKey: 'HUDU_API_KEY',
  baseUrl: 'HUDU_BASE_URL',
} as const;

export interface HuduCredentials {
  apiKey: string;
  baseUrl: string;
}

export class HuduCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuduCredentialsError';
  }
}

/**
 * Resolve Hudu credentials for a tenant.
 *
 * Precedence: tenant secret (`hudu_api_key` / `hudu_base_url`) -> env fallback
 * (`HUDU_API_KEY` / `HUDU_BASE_URL`). Each field is resolved independently so a
 * base URL stored in the tenant secret can coexist with an env-provided key (and
 * vice versa). Throws HuduCredentialsError when either field is missing.
 */
export async function resolveHuduCredentials(tenantId?: string): Promise<HuduCredentials> {
  const secretProvider = await getSecretProviderInstance();

  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  if (tenantId) {
    apiKey = nonEmpty(await secretProvider.getTenantSecret(tenantId, HUDU_SECRET_KEYS.apiKey));
    baseUrl = nonEmpty(await secretProvider.getTenantSecret(tenantId, HUDU_SECRET_KEYS.baseUrl));
  }

  if (!apiKey) {
    apiKey = nonEmpty(process.env[HUDU_ENV_VARS.apiKey]);
  }
  if (!baseUrl) {
    baseUrl = nonEmpty(process.env[HUDU_ENV_VARS.baseUrl]);
  }

  const missing: string[] = [];
  if (!apiKey) missing.push('API key');
  if (!baseUrl) missing.push('base URL');

  if (missing.length > 0) {
    // SECURITY: message names only which field is missing, never any value.
    throw new HuduCredentialsError(
      `Hudu ${missing.join(' and ')} not configured. Set the ${HUDU_SECRET_KEYS.apiKey}/${HUDU_SECRET_KEYS.baseUrl} tenant secrets or ${HUDU_ENV_VARS.apiKey}/${HUDU_ENV_VARS.baseUrl} environment variables.`
    );
  }

  return { apiKey: apiKey as string, baseUrl: baseUrl as string };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
