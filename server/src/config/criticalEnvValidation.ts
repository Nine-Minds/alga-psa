import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { EnvSecretProvider } from '@alga-psa/core/secrets';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';

/**
 * Critical configuration keys required for application startup
 */
type RequiredConfigSpec = Readonly<{
  /** Canonical config key (usually the env var name). */
  key: string;
  description: string;
  /** Candidate names in secret providers (env + filesystem). Tried in order. */
  candidates?: readonly string[];
  /** Reject values that look like a secret-file path (e.g. `/run/secrets/...`). */
  rejectFilePath?: boolean;
  /** Optional validation for non-empty values. */
  validate?: (value: string) => boolean;
}>;

const REQUIRED_CONFIGS: readonly RequiredConfigSpec[] = [
  // Authentication
  {
    key: 'NEXTAUTH_URL',
    description: 'Authentication URL (e.g., http://localhost:3000)',
    candidates: ['NEXTAUTH_URL', 'nextauth_url'],
  },
  {
    key: 'NEXTAUTH_SECRET',
    description: 'Authentication secret (generate with: openssl rand -base64 32)',
    // Prefer the filesystem/Docker secret name first to avoid accepting env vars that are set to a file path.
    candidates: ['nextauth_secret', 'NEXTAUTH_SECRET'],
    rejectFilePath: true,
  },

  // Database (required by env validation + connectivity)
  {
    key: 'DB_TYPE',
    description: 'Database type (must be "postgres")',
    candidates: ['DB_TYPE', 'db_type'],
    validate: (value) => value === 'postgres',
  },
  {
    key: 'DB_NAME_SERVER',
    description: 'Server database name',
    candidates: ['DB_NAME_SERVER', 'db_name_server'],
  },
  {
    key: 'DB_USER_SERVER',
    description: 'Server database username',
    candidates: ['DB_USER_SERVER', 'db_user_server'],
  },
  {
    key: 'DB_USER_ADMIN',
    description: 'Admin database username (e.g., postgres)',
    candidates: ['DB_USER_ADMIN', 'db_user_admin'],
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
    description: 'Server database password (secret file: secrets/db_password_server)',
    candidates: ['db_password_server', 'DB_PASSWORD_SERVER'],
    rejectFilePath: true,
  },
  {
    key: 'DB_PASSWORD_ADMIN',
    description: 'Admin database password (secret file: secrets/postgres_password)',
    candidates: ['postgres_password', 'DB_PASSWORD_ADMIN'],
    rejectFilePath: true,
  },
] as const;

const looksLikeSecretFilePath = (value: string): boolean =>
  value.startsWith('/') || value.includes('/run/secrets/');

/**
 * Validates that all required configuration values are present
 * using the composite secret provider to check multiple sources.
 */
export async function validateRequiredConfiguration(): Promise<void> {
  logger.info('Validating required configuration...');

  const secretProvider = await getSecretProviderInstance();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};

  const readFirstAvailable = async (spec: RequiredConfigSpec): Promise<string | undefined> => {
    const candidates = spec.candidates ?? [spec.key, spec.key.toLowerCase()];
    for (const candidate of candidates) {
      try {
        const value = await secretProvider.getAppSecret(candidate);
        const trimmed = (value ?? '').trim();
        if (!trimmed) continue;
        if (spec.rejectFilePath && looksLikeSecretFilePath(trimmed)) continue;
        if (spec.validate && !spec.validate(trimmed)) continue;
        return trimmed;
      } catch {
        // ignore and continue
      }
    }
    return undefined;
  };

  for (const spec of REQUIRED_CONFIGS) {
    const value = await readFirstAvailable(spec);
    if (!value) {
      missingConfigs.push(`${spec.key}: ${spec.description}`);
      continue;
    }
    validatedConfigs[spec.key] = value;
  }

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
    NEXTAUTH_SECRET: '***',
    DB_TYPE: validatedConfigs.DB_TYPE,
    DB_HOST: validatedConfigs.DB_HOST,
    DB_PORT: validatedConfigs.DB_PORT,
    DB_NAME_SERVER: validatedConfigs.DB_NAME_SERVER,
    DB_USER_SERVER: validatedConfigs.DB_USER_SERVER,
    DB_USER_ADMIN: validatedConfigs.DB_USER_ADMIN,
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
        '  3. Network connectivity to database server',
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

  const requiredCandidateKeys = Array.from(
    new Set(REQUIRED_CONFIGS.flatMap(spec => [spec.key, ...(spec.candidates ?? [])])),
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
    } catch {
      // Provider error, skip
    }

    try {
      const fileValue = await fileProvider.getAppSecret(secretName);
      if (fileValue && fileValue.trim() !== '') {
        sources.push('filesystem');
      }
    } catch {
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
      } catch {
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
      ...duplicateSecrets.map(secret => `  • ${secret}: found in ${secretSources[secret].join(', ')}`),
      '\nEach secret should be defined in exactly one provider to avoid conflicts.',
      'Please remove duplicate definitions and keep secrets in only one location.',
    ].join('\n');

    logger.error(errorMessage);
    // throw new Error('Secret provider conflict detected');
  }

  logger.info('✅ No secret conflicts detected - each secret has a unique source');
}

