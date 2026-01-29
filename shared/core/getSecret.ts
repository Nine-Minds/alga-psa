type GetSecretFn = (
  secretName: string,
  envVar?: string,
  defaultValue?: string
) => Promise<string>;

let cachedCoreGetSecret: Promise<GetSecretFn | null> | null = null;

async function resolveCoreGetSecret(): Promise<GetSecretFn | null> {
  if (!cachedCoreGetSecret) {
    cachedCoreGetSecret = import('@alga-psa/core/server')
      .then((mod) => (typeof mod.getSecret === 'function' ? (mod.getSecret as GetSecretFn) : null))
      .catch(() => null);
  }

  return cachedCoreGetSecret;
}

export async function getSecret(
  secretName: string,
  envVar?: string,
  defaultValue: string = ''
): Promise<string> {
  const coreGetSecret = await resolveCoreGetSecret();
  if (coreGetSecret) {
    return coreGetSecret(secretName, envVar, defaultValue);
  }

  if (envVar) {
    const candidate = process.env[envVar];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return defaultValue;
}
