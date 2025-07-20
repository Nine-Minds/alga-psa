/// <reference types="node" />
import { ISecretProvider } from './ISecretProvider.js';
import { FileSystemSecretProvider } from './FileSystemSecretProvider.js';
import { EnvSecretProvider } from './EnvSecretProvider.js';
import { CompositeSecretProvider } from './CompositeSecretProvider.js';
import logger from './logger.js';

// Safe process.env access
const getEnvVar = (name: string): string | undefined => {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
};


let secretProviderInstance: ISecretProvider | null = null;

// Cached concrete provider instances for composite provider
let envProviderInstance: EnvSecretProvider | null = null;
let filesystemProviderInstance: FileSystemSecretProvider | null = null;
let vaultProviderInstance: ISecretProvider | null = null;

/**
 * Supported provider type names for the composite system.
 */
const SUPPORTED_PROVIDER_TYPES = ['env', 'filesystem', 'vault'] as const;
type ProviderType = typeof SUPPORTED_PROVIDER_TYPES[number];

/**
 * Checks if we're running in an Edge Runtime environment
 */
function isEdgeRuntime(): boolean {
  // Check for Edge Runtime global (safer approach)
  if (typeof globalThis !== 'undefined' && 'EdgeRuntime' in globalThis) {
    return true;
  }
  
  // Check environment variable with safe access
  if (getEnvVar('NEXT_RUNTIME') === 'edge') {
    return true;
  }
  
  return false;
}

/**
 * Gets or creates a cached instance of the specified provider type.
 * 
 * @param providerType - The type of provider to instantiate
 * @returns The cached provider instance
 * @throws Error if the provider type is unsupported or initialization fails
 */
async function getProviderInstance(providerType: ProviderType): Promise<ISecretProvider> {
  switch (providerType) {
    case 'env':
      if (!envProviderInstance) {
        envProviderInstance = new EnvSecretProvider();
      }
      return envProviderInstance;
    
    case 'filesystem':
      if (!filesystemProviderInstance) {
        filesystemProviderInstance = new FileSystemSecretProvider();
      }
      return filesystemProviderInstance;
    
    case 'vault':
      if (!vaultProviderInstance) {
        if (isEdgeRuntime()) {
          // Use proxy vault provider in Edge Runtime
          const { ProxyVaultSecretProvider } = await import('./ProxyVaultSecretProvider.js');
          vaultProviderInstance = new ProxyVaultSecretProvider();
          logger.info('Using ProxyVaultSecretProvider for Edge Runtime');
        } else {
          // Use direct vault provider in Node.js runtime
          // Dynamically import the vault loader to avoid Edge Runtime bundle analysis
          try {
            const { loadVaultSecretProvider } = await import(/* webpackIgnore: true */ './vaultLoader.js');
            vaultProviderInstance = await loadVaultSecretProvider();
            logger.info('Using VaultSecretProvider for Node.js runtime');
          } catch (error) {
            logger.error('Failed to load VaultSecretProvider:', error);
            throw new Error('VaultSecretProvider unavailable in current runtime');
          }
        }
      }
      if (!vaultProviderInstance) {
        throw new Error('Failed to initialize vault provider');
      }
      return vaultProviderInstance;
    
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

/**
 * Validates provider configuration and required environment variables.
 * 
 * @param readChain - Array of provider type names for the read chain
 * @param writeProvider - Provider type name for writes
 * @throws Error if configuration is invalid or required environment variables are missing
 */
function validateProviderConfiguration(readChain: string[], writeProvider: string): void {
  // Validate read chain provider names
  const invalidReadProviders = readChain.filter(type => !SUPPORTED_PROVIDER_TYPES.includes(type as ProviderType));
  if (invalidReadProviders.length > 0) {
    throw new Error(`Invalid provider types in SECRET_READ_CHAIN: ${invalidReadProviders.join(', ')}. Supported types: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`);
  }

  // Validate write provider name
  if (!SUPPORTED_PROVIDER_TYPES.includes(writeProvider as ProviderType)) {
    throw new Error(`Invalid SECRET_WRITE_PROVIDER: ${writeProvider}. Supported types: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`);
  }

  // Validate required environment variables for each configured provider
  const allProviders = new Set([...readChain, writeProvider]);
  
  for (const providerType of allProviders) {
    switch (providerType) {
      case 'vault':
        if (!getEnvVar('VAULT_ADDR')) {
          throw new Error('VAULT_ADDR environment variable is required when using vault provider');
        }
        if (!getEnvVar('VAULT_TOKEN')) {
          throw new Error('VAULT_TOKEN environment variable is required when using vault provider');
        }
        break;
      // env and filesystem providers don't have required environment variables
      // (they have optional ones like SECRET_ENV_PREFIX and SECRET_FS_BASE_PATH)
    }
  }
}

/**
 * Builds a composite secret provider based on environment variable configuration.
 * 
 * @returns A configured CompositeSecretProvider instance
 * @throws Error if configuration is invalid
 */
async function buildSecretProviders(): Promise<CompositeSecretProvider> {
  const readChainEnv = getEnvVar('SECRET_READ_CHAIN') || 'env,filesystem';
  const writeProviderEnv = getEnvVar('SECRET_WRITE_PROVIDER') || 'filesystem';

  const readChain = readChainEnv.split(',').map(s => s.trim()).filter(s => s.length > 0);
  
  if (readChain.length === 0) {
    throw new Error('SECRET_READ_CHAIN cannot be empty');
  }

  logger.info(`Building composite secret provider. Read chain: [${readChain.join(', ')}], Write provider: ${writeProviderEnv}`);

  // Validate configuration
  validateProviderConfiguration(readChain, writeProviderEnv);

  // Create provider instances
  const readProviders = await Promise.all(readChain.map(type => getProviderInstance(type as ProviderType)));
  const writeProvider = await getProviderInstance(writeProviderEnv as ProviderType);

  return new CompositeSecretProvider(readProviders, writeProvider);
}

// Promise to track initialization for singleton pattern
let initializationPromise: Promise<ISecretProvider> | null = null;

/**
 * Factory function to get the configured secret provider instance.
 * 
 * New behavior: If SECRET_READ_CHAIN or SECRET_WRITE_PROVIDER are set, uses the composite system.
 * Legacy behavior: Reads the SECRET_PROVIDER_TYPE environment variable for backward compatibility.
 * 
 * @returns The singleton instance of the configured ISecretProvider.
 * @throws Error if the selected provider fails to initialize or configuration is invalid.
 */
export async function getSecretProviderInstance(): Promise<ISecretProvider> {
  if (secretProviderInstance) {
    return secretProviderInstance;
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    return await initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    // Check if new composite configuration is present
    const hasCompositeConfig = getEnvVar('SECRET_READ_CHAIN') || getEnvVar('SECRET_WRITE_PROVIDER');
    
    if (hasCompositeConfig) {
      logger.info('Initializing composite secret provider system');
      secretProviderInstance = await buildSecretProviders();
    } else {
      // Fall back to legacy single provider configuration
      const providerType = getEnvVar('SECRET_PROVIDER_TYPE')?.toLowerCase() || 'filesystem';
      logger.info(`Initializing secret provider (legacy mode). Type selected: ${providerType}`);

      switch (providerType) {
        case 'vault':
          secretProviderInstance = await getProviderInstance('vault');
          break;
        case 'filesystem':
        default:
          if (providerType !== 'filesystem') {
            logger.warn(`Invalid SECRET_PROVIDER_TYPE '${getEnvVar('SECRET_PROVIDER_TYPE')}'. Defaulting to 'filesystem'.`);
          }
          secretProviderInstance = await getProviderInstance('filesystem');
          break;
      }
    }

    // Ensure a provider instance was created
    if (!secretProviderInstance) {
      logger.error("Failed to initialize any secret provider!");
      throw new Error("Fatal: Could not initialize secret provider.");
    }

    return secretProviderInstance;
  })();

  return await initializationPromise;
}


// Export the interface for type usage elsewhere using 'export type'
export type { ISecretProvider };

// Optional: Export a ready-to-use instance directly
// This simplifies usage in other modules: import { secrets } from '...'
// export const secrets = getSecretProviderInstance();
