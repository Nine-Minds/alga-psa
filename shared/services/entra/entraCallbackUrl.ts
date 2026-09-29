/**
 * Server-side Entra callback URL resolution.
 *
 * This lives in shared code so the OAuth connect flow, the setup metadata, and
 * the diagnostics report all compute the same expected redirect URI. The
 * precedence (environment variable, then stored app secret, then localhost)
 * matches the historical connect action; diagnostics only ever read it.
 */

export interface AppSecretReader {
  getAppSecret(key: string): Promise<string | undefined | null>;
}

export function computeEntraCallbackUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim() || 'http://localhost:3000';
  return `${trimmed.replace(/\/+$/, '')}/api/auth/microsoft/entra/callback`;
}

/**
 * Resolve the deployment base URL using the historical precedence:
 * process env NEXT_PUBLIC_BASE_URL, stored NEXT_PUBLIC_BASE_URL, process env
 * NEXTAUTH_URL, stored NEXTAUTH_URL, then localhost. Never writes.
 */
export async function resolveEntraDeploymentBaseUrl(
  secretProvider: AppSecretReader
): Promise<string> {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return (base || 'http://localhost:3000').trim();
}

export async function resolveEntraCallbackUrl(
  secretProvider: AppSecretReader
): Promise<string> {
  return computeEntraCallbackUrl(await resolveEntraDeploymentBaseUrl(secretProvider));
}
