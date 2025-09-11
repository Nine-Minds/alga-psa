import { getSecretProviderInstance } from './secretProvider.js';

/**
 * Gets a secret value from the secret provider system or environment variable
 * @param secretName - Name of the secret (e.g. 'postgres_password')
 * @param envVar - Name of the fallback environment variable
 * @param defaultValue - Optional default value if neither source exists
 * @returns The secret value as a string
 * @deprecated Use getSecretProviderInstance().getAppSecret() directly for better type safety and consistency
 */
export async function getSecret(secretName: string, envVar: string, defaultValue: string = ''): Promise<string> {
  try {
    const secretProvider = await getSecretProviderInstance();
    const secret = await secretProvider.getAppSecret(secretName);
    if (secret) {
      return secret;
    } 
  } catch (error) {
    console.warn(`Failed to read secret '${secretName}' from secret provider:`, error instanceof Error ? error.message : 'Unknown error');
  }
  
  // Fallback to environment variable
  if (process.env[envVar]) {
    let envValue = process.env[envVar] || defaultValue;
    console.warn(`Using ${envVar} environment variable instead of secret provider`);
    console.log(`Environment variable ${envVar} value: ${envValue}`);
    return envValue;
  }
  
  console.warn(`Neither secret provider nor ${envVar} environment variable found, using default value`);
  return defaultValue;
}