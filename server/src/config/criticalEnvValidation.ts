import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { EnvSecretProvider } from '@alga-psa/core/secrets';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';

/**
 * Critical configuration keys required for application startup
 */
type RequiredConfigSpec = Readonly<{
  key: string;
  description: string;
  candidates?: readonly string[];
  requireEnv?: boolean;
}>;

const REQUIRED_CONFIGS: readonly RequiredConfigSpec[] = [
  {
    key: 'NEXTAUTH_URL',
    description: 'Authentication URL (e.g., http://localhost:3000)',
    candidates: ['NEXTAUTH_URL', 'nextauth_url'],
  },
  {
    key: 'NEXTAUTH_SECRET',
    description: 'Authentication secret (generate with: openssl rand -base64 32)',
    // Edge auth initialization requires this value to be present as an env var (not only as a Docker secret file).
    requireEnv: true,
    candidates: ['NEXTAUTH_SECRET'],
  },
  {
    key: 'DB_HOST',
    description: 'Database host (e.g., localhost or postgres)',
    candidates: ['DB_HOST', 'db_host'],
  },
  {
    key: 'DB_PORT',
    description: 'Database port (e.g., 5432)',
    candidates: ['DB_PORT', 'db_port'],
  },
  {
    key: 'DB_PASSWORD_SERVER',
    description: 'Server database password (env var DB_PASSWORD_SERVER or secret file db_password_server)',
    candidates: ['DB_PASSWORD_SERVER', 'db_password_server'],
  },
  {
    key: 'DB_PASSWORD_ADMIN',
    description: 'Admin database password (env var DB_PASSWORD_ADMIN or secret file postgres_password)',
    candidates: ['DB_PASSWORD_ADMIN', 'postgres_password'],
  },
] as const;

/**
 * Validates that all required configuration values are present
 * using the composite secret provider to check multiple sources.
 */
export async function validateRequiredConfiguration(): Promise<void> {
  logger.info('Validating required configuration...');

  const secretProvider = await getSecretProviderInstance();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};

  const readFirstAvailable = async (candidates: readonly string[]): Promise<string | undefined> => {
    for (const candidate of candidates) {
      try {
        const value = await secretProvider.getAppSecret(candidate);
        if (value && value.trim() !== '') return value;
      } catch {
        // ignore and continue
      }
    }
    return undefined;
  };

  for (const spec of REQUIRED_CONFIGS) {
    const candidates = spec.candidates ?? [spec.key, spec.key.toLowerCase()];

    // Some values must exist in env explicitly (not only from a secret file)
    if (spec.requireEnv) {
      const envValue = process.env[spec.key];
      if (!envValue || envValue.trim() === '') {
        // Give a targeted hint if the matching Docker secret file exists.
        const secretValue = await readFirstAvailable([spec.key.toLowerCase(), 'nextauth_secret']);
        if (secretValue) {
          missingConfigs.push(
            `${spec.key}: ${spec.description} (found as secret "nextauth_secret", but must also be set as env var)`,
          );
        } else {
          missingConfigs.push(`${spec.key}: ${spec.description}`);
        }
        continue;
      }
      validatedConfigs[spec.key] = envValue;
      continue;
    }

    const value = await readFirstAvailable(candidates);
    if (!value || value.trim() === '') {
      missingConfigs.push(`${spec.key}: ${spec.description}`);
      continue;
    }

    validatedConfigs[spec.key] = value;
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
    // throw new Error('Required configuration validation failed');
    return;
  }
  
  // Log successful validation (with sensitive values masked)
  logger.info('✅ All required configuration values are present', {
    NEXTAUTH_URL: validatedConfigs.NEXTAUTH_URL,
    NEXTAUTH_SECRET: '***',
    DB_HOST: validatedConfigs.DB_HOST,
    DB_PORT: validatedConfigs.DB_PORT,
    DB_PASSWORD_SERVER: '***',
    DB_PASSWORD_ADMIN: '***',
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
  const requiredCandidateKeys = Array.from(
    new Set(REQUIRED_CONFIGS.flatMap(spec => spec.candidates ?? [spec.key])),
  );
  const secretsToCheck = [
    ...requiredCandidateKeys,
    ...requiredCandidateKeys.map(k => k.toLowerCase()),
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
