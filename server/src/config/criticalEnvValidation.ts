import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { EnvSecretProvider } from '@alga-psa/core/secrets';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';

/**
 * Critical configuration keys required for application startup
 */
type RequiredConfigSpec = {
  key: string;
  description: string;
  lookups: string[];
  masked?: boolean;
};

const REQUIRED_CONFIGS: RequiredConfigSpec[] = [
  // Authentication
  {
    key: 'NEXTAUTH_URL',
    description: 'Authentication URL (e.g., http://localhost:3000)',
    lookups: ['NEXTAUTH_URL'],
  },
  {
    // NOTE: Prefer validating the filesystem/Docker secret file name (`nextauth_secret`) rather than
    // the env var to avoid false positives when an env var contains a file path like `/run/secrets/nextauth_secret`.
    key: 'nextauth_secret',
    description: 'NextAuth secret (filesystem/Docker secret file: secrets/nextauth_secret)',
    lookups: ['nextauth_secret', 'NEXTAUTH_SECRET'],
    masked: true,
  },

  // Database
  {
    key: 'DB_TYPE',
    description: 'Database type (must be "postgres")',
    lookups: ['DB_TYPE'],
  },
  {
    key: 'DB_NAME_SERVER',
    description: 'Server database name',
    lookups: ['DB_NAME_SERVER'],
  },
  {
    key: 'DB_USER_SERVER',
    description: 'Server database username',
    lookups: ['DB_USER_SERVER'],
  },
  {
    key: 'DB_USER_ADMIN',
    description: 'Admin database username (e.g., postgres)',
    lookups: ['DB_USER_ADMIN'],
  },
  {
    key: 'DB_HOST',
    description: 'Database host (e.g., localhost or postgres)',
    lookups: ['DB_HOST'],
  },
  {
    key: 'DB_PORT',
    description: 'Database port (e.g., 5432)',
    lookups: ['DB_PORT'],
  },
  {
    key: 'db_password_server',
    description: 'Server database password (filesystem/Docker secret file: secrets/db_password_server)',
    lookups: ['db_password_server', 'DB_PASSWORD_SERVER'],
    masked: true,
  },
  {
    key: 'postgres_password',
    description: 'Admin database password (filesystem/Docker secret file: secrets/postgres_password)',
    lookups: ['postgres_password', 'DB_PASSWORD_ADMIN'],
    masked: true,
  },
];

/**
 * Validates that all required configuration values are present
 * using the composite secret provider to check multiple sources.
 */
export async function validateRequiredConfiguration(): Promise<void> {
  logger.info('Validating required configuration...');

  const secretProvider = await getSecretProviderInstance();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};

  const resolveSpecValue = async (spec: RequiredConfigSpec): Promise<string | undefined> => {
    for (const lookupKey of spec.lookups) {
      const value = await secretProvider.getAppSecret(lookupKey);
      const trimmed = value?.trim();
      if (!trimmed) {
        continue;
      }

      if ((spec.key === 'nextauth_secret' || lookupKey === 'NEXTAUTH_SECRET') && trimmed.startsWith('/run/secrets/')) {
        continue;
      }

      if (trimmed !== '') {
        return value;
      }
    }
    return undefined;
  };

  for (const spec of REQUIRED_CONFIGS) {
    try {
      const value = await resolveSpecValue(spec);
      if (!value || value.trim() === '') {
        missingConfigs.push(`${spec.key}: ${spec.description}`);
      } else {
        validatedConfigs[spec.key] = value;
      }
    } catch (error) {
      // If secret provider throws, treat as missing
      missingConfigs.push(`${spec.key}: ${spec.description}`);
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
  logger.info('Testing database connectivity...');

  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME_SERVER || 'server';
  const user = process.env.DB_USER_SERVER || 'app_user';

  const maxAttempts = Number(process.env.DB_CONNECTIVITY_MAX_ATTEMPTS || 15);
  const baseDelayMs = Number(process.env.DB_CONNECTIVITY_RETRY_DELAY_MS || 1000);

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Import dynamically to avoid circular dependencies
      const { getConnection, resetTenantConnectionPool } = await import('server/src/lib/db/db');

      // Ensure we don't keep a pool stuck in a bad state across retries.
      await resetTenantConnectionPool();

      const knex = await getConnection(null);
      await knex.raw('SELECT 1');
      logger.info('✅ Database connection successful');
      return;
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      const delayMs = Math.min(baseDelayMs * attempt, 5000);

      const errorMessage =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

      if (isLastAttempt) {
        logger.error('❌ Database connection failed:', error);
        throw new Error(
          'Database connection failed. Please check:\n' +
            `  1. Database server is running (host=${host} port=${port})\n` +
            `  2. Connection parameters are correct (db=${database} user=${user})\n` +
            '  3. Network connectivity to database server\n' +
            `  4. Underlying error: ${errorMessage}`
        );
      }

      logger.warn(
        `Database not ready yet (attempt ${attempt}/${maxAttempts}) - retrying in ${delayMs}ms: ${errorMessage}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Should be unreachable, but keep a safe fallback.
  logger.error('❌ Database connection failed after retries:', lastError);
  throw new Error('Database connection failed after retries.');
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
    ...REQUIRED_CONFIGS.flatMap(spec => spec.lookups),
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
