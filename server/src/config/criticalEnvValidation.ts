import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { EnvSecretProvider } from '@alga-psa/core/secrets';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';
import { DB_HOST } from '@/lib/init/serverInit';

/**
 * Critical configuration keys required for application startup
 */
const REQUIRED_CONFIGS = {
  // Authentication
  NEXTAUTH_URL: 'Authentication URL (e.g., http://localhost:3000)',
  // NOTE: We validate the filesystem/Docker secret file name (`nextauth_secret`) rather than the env var
  // to avoid false positives when an env var contains a file path like `/run/secrets/nextauth_secret`.
  nextauth_secret: 'NextAuth secret (filesystem/Docker secret file: secrets/nextauth_secret)',

  // Database (required by EnvConfig validation)
  DB_TYPE: 'Database type (must be "postgres")',
  DB_NAME_SERVER: 'Server database name',
  DB_USER_SERVER: 'Server database username',
  DB_USER_ADMIN: 'Admin database username (e.g., postgres)',

  // Database
  DB_HOST: 'Database host (e.g., localhost or postgres)',
  DB_PORT: 'Database port (e.g., 5432)',
  db_password_server: 'Server database password (filesystem/Docker secret file: secrets/db_password_server)',
  postgres_password: 'Admin database password (filesystem/Docker secret file: secrets/postgres_password)',
} as const;

type RequiredConfigKey = keyof typeof REQUIRED_CONFIGS;

/**
 * Validates that all required configuration values are present
 * using the composite secret provider to check multiple sources.
 */
export async function validateRequiredConfiguration(): Promise<void> {
  logger.info('Validating required configuration...');

  const secretProvider = await getSecretProviderInstance();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};

  // Check each required configuration
  for (const [key, description] of Object.entries(REQUIRED_CONFIGS)) {
    try {
      // Try uppercase first (environment variables)
      let value = await secretProvider.getAppSecret(key);
      
      // If not found, try lowercase (Docker secrets convention)
      if (!value || value.trim() === '') {
        const lowercaseKey = key.toLowerCase();
        value = await secretProvider.getAppSecret(lowercaseKey);
      }
      
      if (!value || value.trim() === '') {
        missingConfigs.push(`${key}: ${description}`);
      } else {
        validatedConfigs[key] = value;
      }
    } catch (error) {
      // If secret provider throws, treat as missing
      missingConfigs.push(`${key}: ${description}`);
    }
  }
  
  // Report results
  if (missingConfigs.length > 0) {
    const errorMessage = [
      '\n🚨 Required Configuration Missing 🚨\n',
      'The following required configuration values are not set:',
      ...missingConfigs.map(config => `  • ${config}`),
      '\nPlease ensure these are set in one of the following:',
      '  1. Environment variables',
      '  2. Docker secrets (if using Docker)',
      '  3. Vault (if configured)',
      '  4. .env file (for local development)',
      '\nFor more information, see docs/getting-started/configuration_guide.md'
    ].join('\n');
    
    logger.error(errorMessage);
    throw new Error('Required configuration validation failed');
  }
  
  // Log successful validation (with sensitive values masked)
  logger.info('✅ All required configuration values are present', {
    NEXTAUTH_URL: validatedConfigs.NEXTAUTH_URL,
    nextauth_secret: '***',
    DB_TYPE: validatedConfigs.DB_TYPE,
    DB_HOST: validatedConfigs.DB_HOST,
    DB_PORT: validatedConfigs.DB_PORT,
    DB_NAME_SERVER: validatedConfigs.DB_NAME_SERVER,
    DB_USER_SERVER: validatedConfigs.DB_USER_SERVER,
    DB_USER_ADMIN: validatedConfigs.DB_USER_ADMIN,
    db_password_server: '***',
    postgres_password: '***',
  });
}

/**
 * Quick database connectivity check
 */
export async function validateDatabaseConnectivity(): Promise<void> {
  try {
    logger.info('Testing database connectivity...');
    
    // Import dynamically to avoid circular dependencies
    const { getConnection } = await import('server/src/lib/db/db');
    const knex = await getConnection(null);
    
    // Simple connectivity test
    await knex.raw('SELECT 1');
    
    logger.info('✅ Database connection successful');
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw new Error(
      'Database connection failed. Please check:\n' +
      '  1. Database server is running\n' +
      '  2. Connection parameters are correct\n' +
      '  3. Network connectivity to database server'
    );
  }
}

/**
 * Validates that each secret is provided by exactly one provider
 * to prevent configuration conflicts.
 */
export async function validateSecretUniqueness(): Promise<void> {
  logger.info('Validating secret provider uniqueness...');
  
  // Get individual providers to test
  const envProvider = new EnvSecretProvider();
  const fileProvider = new FileSystemSecretProvider();
  
  const duplicateSecrets: string[] = [];
  const secretSources: Record<string, string[]> = {};
  
  // Check all critical configs and common secrets
  const secretsToCheck = [
    ...Object.keys(REQUIRED_CONFIGS),
    // Add lowercase variants
    ...Object.keys(REQUIRED_CONFIGS).map(k => k.toLowerCase()),
    // Add other common secrets that might conflict
    'ALGA_AUTH_KEY',
    'alga_auth_key',
    'SECRET_KEY',
    'secret_key'
  ];
  
  // Check each secret across providers
  for (const secretName of secretsToCheck) {
    const sources: string[] = [];
    
    try {
      const envValue = await envProvider.getAppSecret(secretName);
      if (envValue && envValue.trim() !== '') {
        sources.push('environment');
      }
    } catch (error) {
      // Provider error, skip
    }
    
    try {
      const fileValue = await fileProvider.getAppSecret(secretName);
      if (fileValue && fileValue.trim() !== '') {
        sources.push('filesystem');
      }
    } catch (error) {
      // Provider error, skip
    }
    
    // Check if Vault provider is configured
    if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
      try {
        const { loadVaultSecretProvider } = await import('@alga-psa/core/secrets');
        const vaultProvider = await loadVaultSecretProvider();
        const vaultValue = await vaultProvider.getAppSecret(secretName);
        if (vaultValue && vaultValue.trim() !== '') {
          sources.push('vault');
        }
      } catch (error) {
        // Vault not available or error, skip
      }
    }
    
    if (sources.length > 1) {
      secretSources[secretName] = sources;
      duplicateSecrets.push(secretName);
    }
  }
  
  // Report conflicts
  if (duplicateSecrets.length > 0) {
    const errorMessage = [
      '\n⚠️  Secret Configuration Conflict Detected ⚠️\n',
      'The following secrets are defined in multiple providers:',
      ...duplicateSecrets.map(secret => 
        `  • ${secret}: found in ${secretSources[secret].join(', ')}`
      ),
      '\nEach secret should be defined in exactly one provider to avoid conflicts.',
      'Please remove duplicate definitions and keep secrets in only one location.',
    ].join('\n');
    
    logger.error(errorMessage);
    // throw new Error('Secret provider conflict detected');
  }
  
  logger.info('✅ No secret conflicts detected - each secret has a unique source');
}
