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