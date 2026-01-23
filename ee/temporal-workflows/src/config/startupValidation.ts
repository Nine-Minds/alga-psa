import { createLogger } from 'winston';

// Configure logger for startup validation
const logger = createLogger({
  level: 'info',
  transports: []
});

type SecretProvider = {
  getAppSecret(key: string): Promise<string | undefined>;
};

let secretProviderPromise: Promise<SecretProvider> | null = null;

async function getSecretProvider(): Promise<SecretProvider> {
  if (!secretProviderPromise) {
    secretProviderPromise = (async () => {
      try {
        const module = await import('@alga-psa/core/secrets.js');
        const factory = (module as { getSecretProviderInstance?: () => Promise<SecretProvider> })
          .getSecretProviderInstance;
        if (typeof factory === 'function') {
          return await factory();
        }
      } catch (error) {
        logger.warn('Secret provider module unavailable, defaulting to env-only provider', {
          error: error instanceof Error ? error.message : error,
        });
      }

      return {
        async getAppSecret(key: string): Promise<string | undefined> {
          return process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()];
        },
      } satisfies SecretProvider;
    })();
  }

  return secretProviderPromise;
}

/**
 * Critical configuration keys required for temporal worker startup
 */
const REQUIRED_CONFIGS = {
  // Authentication
  ALGA_AUTH_KEY: 'Shared authentication key for internal API calls',
  NEXTAUTH_SECRET: 'Secret used by NextAuth for session management and password hashing',
  APPLICATION_URL: 'Base URL for the application',

  // Database
  DB_HOST: 'Database host (e.g., localhost or postgres)',
  DB_PORT: 'Database port (e.g., 5432)',
  DB_NAME_SERVER: 'Server database name',
  DB_USER_SERVER: 'Server database username',
  DB_PASSWORD_SERVER: 'Server database password',
  
  // Admin credentials for tenant operations
  DB_USER_ADMIN: 'Admin database username (e.g., postgres)',
  DB_PASSWORD_ADMIN: 'Admin database password',
  
  // Temporal
  TEMPORAL_ADDRESS: 'Temporal server address (e.g., temporal-frontend:7233)',
  TEMPORAL_NAMESPACE: 'Temporal namespace (e.g., default)',
  TEMPORAL_TASK_QUEUE: 'Temporal task queue name',
  PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE: 'Existing VirtualService name that anchors portal routing',
} as const;

/**
 * Optional configuration with defaults
 */
const OPTIONAL_CONFIGS = {
  // Email
  EMAIL_PROVIDER: { default: 'mock', description: 'Email provider (mock, resend, etc.)' },
  RESEND_API_KEY: { default: undefined, description: 'Resend API key (required if provider is resend)' },
  RESEND_DEFAULT_FROM_ADDRESS: { default: 'noreply@example.com', description: 'Default from email address' },
  RESEND_DEFAULT_FROM_NAME: { default: 'System', description: 'Default from name' },
  
  // Worker configuration
  MAX_CONCURRENT_ACTIVITIES: { default: '10', description: 'Maximum concurrent activities' },
  MAX_CONCURRENT_WORKFLOWS: { default: '10', description: 'Maximum concurrent workflows' },
  EMAIL_DOMAIN_TASK_QUEUE: { default: 'email-domain-workflows', description: 'Task queue for managed email domain workflows' },
  
  // Health check
  ENABLE_HEALTH_CHECK: { default: 'true', description: 'Enable health check endpoint' },
  HEALTH_CHECK_PORT: { default: '8080', description: 'Health check port' },
  
  // Application
  APPLICATION_URL: { default: undefined, description: 'Application URL for email links' },
  NMSTORE_BASE_URL: { default: undefined, description: 'NM Store base URL' },
} as const;

type RequiredConfigKey = keyof typeof REQUIRED_CONFIGS;
type OptionalConfigKey = keyof typeof OPTIONAL_CONFIGS;

/**
 * Validates that all required configuration values are present
 */
export async function validateRequiredConfiguration(): Promise<void> {
  logger.info('Validating required configuration for temporal worker...');

  const secretProvider = await getSecretProvider();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};

  // Check each required configuration
  for (const [key, description] of Object.entries(REQUIRED_CONFIGS)) {
    try {
      // Try the key as-is first
      let value = await secretProvider.getAppSecret(key);
      
      // If not found and it's from env, check process.env directly
      if (!value || value.trim() === '') {
        value = process.env[key];
      }
      
      // If not found, try lowercase (Docker secrets convention)
      if (!value || value.trim() === '') {
        const lowercaseKey = key.toLowerCase();
        value = await secretProvider.getAppSecret(lowercaseKey);
      }
      
      if (!value || value.trim() === '') {
        missingConfigs.push(`${key}: ${description}`);
      } else {
        validatedConfigs[key] = value;
        // Ensure it's available in process.env for legacy code
        process.env[key] = value;
      }
    } catch (error) {
      // If secret provider throws, treat as missing
      missingConfigs.push(`${key}: ${description}`);
    }
  }
  
  // Report results
  if (missingConfigs.length > 0) {
    const errorMessage = [
      '\n🚨 Required Configuration Missing for Temporal Worker 🚨\n',
      'The following required configuration values are not set:',
      ...missingConfigs.map(config => `  • ${config}`),
      '\nPlease ensure these are set in one of the following:',
      '  1. Environment variables',
      '  2. Vault secrets (via agent injection)',
      '  3. Docker secrets (if using Docker)',
      '  4. .env file (for local development)',
    ].join('\n');
    
    logger.error(errorMessage);
    throw new Error('Required configuration validation failed');
  }
  
  // Log successful validation (with sensitive values masked)
  logger.info('✅ All required configuration values are present', {
    ALGA_AUTH_KEY: '***',
    DB_HOST: validatedConfigs.DB_HOST,
    DB_PORT: validatedConfigs.DB_PORT,
    DB_NAME_SERVER: validatedConfigs.DB_NAME_SERVER,
    DB_USER_SERVER: validatedConfigs.DB_USER_SERVER,
    DB_PASSWORD_SERVER: '***',
    DB_USER_ADMIN: validatedConfigs.DB_USER_ADMIN,
    DB_PASSWORD_ADMIN: '***',
    TEMPORAL_ADDRESS: validatedConfigs.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: validatedConfigs.TEMPORAL_NAMESPACE,
    TEMPORAL_TASK_QUEUE: validatedConfigs.TEMPORAL_TASK_QUEUE,
    PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE:
      validatedConfigs.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE,
  });
}

/**
 * Validates optional configuration and sets defaults
 */
export async function validateOptionalConfiguration(): Promise<void> {
  logger.info('Validating optional configuration for temporal worker...');

  const secretProvider = await getSecretProvider();
  const configuredValues: Record<string, string> = {};

  // Check each optional configuration
  for (const [key, config] of Object.entries(OPTIONAL_CONFIGS)) {
    try {
      // Try to get the value from secret provider
      let value = await secretProvider.getAppSecret(key);
      
      // If not found, check process.env
      if (!value || value.trim() === '') {
        value = process.env[key];
      }
      
      // If not found, try lowercase
      if (!value || value.trim() === '') {
        const lowercaseKey = key.toLowerCase();
        value = await secretProvider.getAppSecret(lowercaseKey);
      }
      
      // Use default if still not found
      if (!value || value.trim() === '') {
        value = config.default;
      }
      
      if (value !== undefined) {
        configuredValues[key] = value;
        // Ensure it's available in process.env
        process.env[key] = value;
      }
    } catch (error) {
      // Use default on error
      if (config.default !== undefined) {
        configuredValues[key] = config.default;
        process.env[key] = config.default;
      }
    }
  }

  // Special validation: If EMAIL_PROVIDER is 'resend', RESEND_API_KEY is required
  if (configuredValues.EMAIL_PROVIDER === 'resend' && !configuredValues.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER is set to "resend"');
  }

  logger.info('✅ Optional configuration validated', {
    EMAIL_PROVIDER: configuredValues.EMAIL_PROVIDER,
    RESEND_API_KEY: configuredValues.RESEND_API_KEY ? '***' : 'not set',
    MAX_CONCURRENT_ACTIVITIES: configuredValues.MAX_CONCURRENT_ACTIVITIES,
    MAX_CONCURRENT_WORKFLOWS: configuredValues.MAX_CONCURRENT_WORKFLOWS,
    EMAIL_DOMAIN_TASK_QUEUE: configuredValues.EMAIL_DOMAIN_TASK_QUEUE,
    ENABLE_HEALTH_CHECK: configuredValues.ENABLE_HEALTH_CHECK,
    HEALTH_CHECK_PORT: configuredValues.HEALTH_CHECK_PORT,
  });
}

/**
 * Quick database connectivity check
 */
export async function validateDatabaseConnectivity(): Promise<void> {
  try {
    logger.info('Testing database connectivity...');
    
    // Simple connectivity test using pg directly
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER_SERVER,
      password: process.env.DB_PASSWORD_SERVER,
      database: process.env.DB_NAME_SERVER,
    });
    
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    
    logger.info('✅ Database connection successful');
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw new Error(
      'Database connection failed. Please check:\n' +
      '  1. Database server is running\n' +
      '  2. Connection parameters are correct\n' +
      '  3. Network connectivity to database server\n' +
      '  4. Database user has proper permissions'
    );
  }
}

/**
 * Validates Temporal connectivity
 */
export async function validateTemporalConnectivity(): Promise<void> {
  try {
    logger.info('Testing Temporal connectivity...');
    
    const { Connection } = await import('@temporalio/client');
    
    // Try to connect to Temporal
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS,
    });
    
    // Close the connection
    await connection.close();
    
    logger.info('✅ Temporal connection successful');
  } catch (error) {
    logger.error('❌ Temporal connection failed:', error);
    throw new Error(
      'Temporal connection failed. Please check:\n' +
      '  1. Temporal server is running\n' +
      '  2. TEMPORAL_ADDRESS is correct\n' +
      '  3. Network connectivity to Temporal server\n' +
      '  4. Temporal namespace exists'
    );
  }
}

/**
 * Main validation function that runs all checks
 */
export async function validateStartup(): Promise<void> {
  logger.info('Starting temporal worker validation...');
  
  try {
    // Critical validations (must pass)
    await validateRequiredConfiguration();
    await validateOptionalConfiguration();
    
    // Connectivity checks
    await validateDatabaseConnectivity();
    await validateTemporalConnectivity();
    
    logger.info('✅ All startup validations passed successfully');
  } catch (error) {
    logger.error('❌ Startup validation failed:', error);
    throw error;
  }
}

/**
 * Log the current configuration (with sensitive values masked)
 */
export function logConfiguration(): void {
  logger.info('Temporal Worker Configuration:', {
    // Database
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME_SERVER: process.env.DB_NAME_SERVER,
    DB_USER_SERVER: process.env.DB_USER_SERVER,
    DB_USER_ADMIN: process.env.DB_USER_ADMIN,
    
    // Temporal
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE,
    TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE,
    PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE:
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE,
    
    // Email
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_DEFAULT_FROM_ADDRESS: process.env.RESEND_DEFAULT_FROM_ADDRESS,
    RESEND_DEFAULT_FROM_NAME: process.env.RESEND_DEFAULT_FROM_NAME,
    
    // Worker
    MAX_CONCURRENT_ACTIVITIES: process.env.MAX_CONCURRENT_ACTIVITIES,
    MAX_CONCURRENT_WORKFLOWS: process.env.MAX_CONCURRENT_WORKFLOWS,
    
    // Health Check
    ENABLE_HEALTH_CHECK: process.env.ENABLE_HEALTH_CHECK,
    HEALTH_CHECK_PORT: process.env.HEALTH_CHECK_PORT,
    
    // Application
    APPLICATION_URL: process.env.APPLICATION_URL,
    NMSTORE_BASE_URL: process.env.NMSTORE_BASE_URL,
    
    // Secret Provider
    SECRET_READ_CHAIN: process.env.SECRET_READ_CHAIN,
    SECRET_WRITE_PROVIDER: process.env.SECRET_WRITE_PROVIDER,
    SECRET_FS_BASE_PATH: process.env.SECRET_FS_BASE_PATH,
  });
}
