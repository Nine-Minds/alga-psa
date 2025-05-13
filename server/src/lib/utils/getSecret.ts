import { getSecretProviderInstance } from '../secrets'; // Import the new singleton secret provider instance
import logger from '@shared/core/logger.js'; // Corrected import path
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Calculate secrets directory path once at module load
const DOCKER_SECRETS_PATH = '/run/secrets';
const LOCAL_SECRETS_PATH = '../secrets';

// Cache the secrets path promise
const SECRETS_PATH_PROMISE = fs.access(DOCKER_SECRETS_PATH)
  .then(() => DOCKER_SECRETS_PATH)
  .catch(() => LOCAL_SECRETS_PATH);

/**
 * Gets a secret value from either a Docker secret file or environment variable
 * @param secretName - Name of the secret (e.g. 'postgres_password')
 * @param envVar - Name of the fallback environment variable
 * @param defaultValue - Optional default value if neither source exists
 * @returns The secret value as a string
 */
export async function getSecret(secretName: string, envVar: string, defaultValue: string = ''): Promise<string> {
  try {
    const secretsPath = await SECRETS_PATH_PROMISE;
    const secretPath = path.join(secretsPath, secretName);
    const value = await fs.readFile(secretPath, 'utf8');
    return value.trim();
  } catch (error) {
    if (process.env[envVar]) {
      console.warn(`Using ${envVar} environment variable instead of Docker secret`);
      return process.env[envVar] || defaultValue;
    }
    console.warn(`Neither secret file nor ${envVar} environment variable found, using default value`);
    return defaultValue;
  }
}

/**
 * Gets a secret value using the configured secret provider, with fallbacks.
 *
 * 1. Attempts to retrieve the secret using the configured ISecretProvider (e.g., filesystem, vault).
 * 2. If the provider doesn't find the secret, it checks the specified environment variable.
 * 3. If neither source provides the secret, it returns the optional default value.
 *
 * @param secretName - Name of the secret (used as key for provider and filename for filesystem).
 * @param envVar - Name of the fallback environment variable.
 * @param defaultValue - Optional default value if neither source exists (defaults to '').
 * @returns The secret value as a string.
 */
// export async function getSecret(secretName: string, envVar: string, defaultValue: string = ''): Promise<string> {
//   // 1. Try the configured secret provider first
//   const secrets = getSecretProviderInstance();
//   const providerSecret = await secrets.getAppSecret(secretName);

//   if (providerSecret !== undefined && providerSecret !== '') {
//     logger.debug(`Retrieved secret '${secretName}' from configured provider.`);
//     return providerSecret;
//   }

//   // 2. If provider didn't find it, try the environment variable
//   logger.debug(`Secret '${secretName}' not found via provider, checking env var '${envVar}'.`);
//   const envSecret = process.env[envVar];
//   if (envSecret !== undefined) {
//     logger.warn(`Using environment variable '${envVar}' for secret '${secretName}'.`);
//     return envSecret;
//   }

//   // 3. If neither worked, use the default value
//   logger.warn(`Secret '${secretName}' not found via provider or env var '${envVar}'. Using default value.`);
//   return defaultValue;
// }
