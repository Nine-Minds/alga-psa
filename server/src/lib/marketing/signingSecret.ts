import { getSecretProviderInstance } from '@alga-psa/core/secrets';

let cachedSecret: string | null = null;

/**
 * Secret for HMAC-signing marketing click-tracking destinations (minted at
 * send time, verified by the public click redirect). Sourced like the auth
 * stack sources it: NEXTAUTH_SECRET from env, then the app secret provider.
 * Returns null when unavailable — senders and the redirect both fail closed.
 */
export async function getMarketingSigningSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const secretProvider = await getSecretProviderInstance();
  const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
  if (fromAppSecret) {
    cachedSecret = fromAppSecret;
    return cachedSecret;
  }
  return null;
}
