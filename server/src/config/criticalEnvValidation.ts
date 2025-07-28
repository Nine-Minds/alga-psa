import logger from '@shared/core/logger';
import { getSecretProviderInstance } from '@shared/core/secretProvider';

/**
 * Critical configuration keys required for application startup
 */
const CRITICAL_CONFIGS = {
  // Authentication
  NEXTAUTH_URL: 'Authentication URL (e.g., http://localhost:3000)',
  NEXTAUTH_SECRET: 'Authentication secret (generate with: openssl rand -base64 32)',
  
  // Database
  DB_HOST: 'Database host (e.g., localhost or postgres)',
  DB_PORT: 'Database port (e.g., 5432)',
  DB_NAME_SERVER: 'Server database name',
  DB_USER_SERVER: 'Server database username',
  DB_PASSWORD_SERVER: 'Server database password',
} as const;

type CriticalConfigKey = keyof typeof CRITICAL_CONFIGS;

/**
 * Validates that all critical configuration values are present
 * using the composite secret provider to check multiple sources.
 */
export async function validateCriticalConfiguration(): Promise<void> {
  logger.info('Validating critical configuration...');
  
  const secretProvider = await getSecretProviderInstance();
  const missingConfigs: string[] = [];
  const validatedConfigs: Record<string, string> = {};
  
  // Check each critical configuration
  for (const [key, description] of Object.entries(CRITICAL_CONFIGS)) {
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
      '\n🚨 Critical Configuration Missing 🚨\n',
      'The following required configuration values are not set:',
      ...missingConfigs.map(config => `  • ${config}`),
      '\nPlease ensure these are set in one of the following:',
      '  1. Environment variables',
      '  2. Docker secrets (if using Docker)',
      '  3. Vault (if configured)',
      '  4. .env file (for local development)',
      '\nFor more information, see docs/configuration_guide.md'
    ].join('\n');
    
    logger.error(errorMessage);
    throw new Error('Critical configuration validation failed');
  }
  
  // Log successful validation (with sensitive values masked)
  logger.info('✅ All critical configuration values are present', {
    NEXTAUTH_URL: validatedConfigs.NEXTAUTH_URL,
    NEXTAUTH_SECRET: '***',
    DB_HOST: validatedConfigs.DB_HOST,
    DB_PORT: validatedConfigs.DB_PORT,
    DB_NAME_SERVER: validatedConfigs.DB_NAME_SERVER,
    DB_USER_SERVER: validatedConfigs.DB_USER_SERVER,
    DB_PASSWORD_SERVER: '***'
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