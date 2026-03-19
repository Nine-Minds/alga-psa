import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import logger from '@alga-psa/core/logger';

export async function getSecret(
  secretName: string,
  envVar: string,
  defaultValue: string = ''
): Promise<string> {
  const secrets = await getSecretProviderInstance();
  const providerSecret = await secrets.getAppSecret(secretName);

  if (providerSecret !== undefined && providerSecret !== '') {
    return providerSecret;
  }

  const envSecret = process.env[envVar];
  if (envSecret !== undefined) {
    logger.warn(`Using environment variable fallback for secret ${envVar}.`);
    return envSecret;
  }

  logger.warn(
    `Secret not found via provider or environment fallback (${envVar}). Using default value.`
  );
  return defaultValue;
}
