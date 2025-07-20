import { ISecretProvider } from './ISecretProvider.js';
import { FileSystemSecretProvider } from './FileSystemSecretProvider.js';
import { VaultSecretProvider } from './VaultSecretProvider.js';
import { EnvSecretProvider } from './EnvSecretProvider.js';
import { CompositeSecretProvider } from './CompositeSecretProvider.js';
import logger from './logger.js';

let secretProviderInstance: ISecretProvider | null = null;

// Cached concrete provider instances for composite provider
let envProviderInstance: EnvSecretProvider | null = null;
let filesystemProviderInstance: FileSystemSecretProvider | null = null;
let vaultProviderInstance: VaultSecretProvider | null = null;

/**
 * Supported provider type names for the composite system.
 */
const SUPPORTED_PROVIDER_TYPES = ['env', 'filesystem', 'vault'] as const;
type ProviderType = typeof SUPPORTED_PROVIDER_TYPES[number];

/**
 * Gets or creates a cached instance of the specified provider type.
 * 
 * @param providerType - The type of provider to instantiate
 * @returns The cached provider instance
 * @throws Error if the provider type is unsupported or initialization fails
 */
function getProviderInstance(providerType: ProviderType): ISecretProvider {
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
        vaultProviderInstance = new VaultSecretProvider();
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
        if (!process.env.VAULT_ADDR) {
          throw new Error('VAULT_ADDR environment variable is required when using vault provider');
        }
        if (!process.env.VAULT_TOKEN) {
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
function buildSecretProviders(): CompositeSecretProvider {
  const readChainEnv = process.env.SECRET_READ_CHAIN || 'env,filesystem';
  const writeProviderEnv = process.env.SECRET_WRITE_PROVIDER || 'filesystem';

  const readChain = readChainEnv.split(',').map(s => s.trim()).filter(s => s.length > 0);
  
  if (readChain.length === 0) {
    throw new Error('SECRET_READ_CHAIN cannot be empty');
  }

  logger.info(`Building composite secret provider. Read chain: [${readChain.join(', ')}], Write provider: ${writeProviderEnv}`);

  // Validate configuration
  validateProviderConfiguration(readChain, writeProviderEnv);

  // Create provider instances
  const readProviders = readChain.map(type => getProviderInstance(type as ProviderType));
  const writeProvider = getProviderInstance(writeProviderEnv as ProviderType);

  return new CompositeSecretProvider(readProviders, writeProvider);
}

/**
 * Factory function to get the configured secret provider instance.
 * 
 * New behavior: If SECRET_READ_CHAIN or SECRET_WRITE_PROVIDER are set, uses the composite system.
 * Legacy behavior: Reads the SECRET_PROVIDER_TYPE environment variable for backward compatibility.
 * 
 * @returns The singleton instance of the configured ISecretProvider.
 * @throws Error if the selected provider fails to initialize or configuration is invalid.
 */
export function getSecretProviderInstance(): ISecretProvider {
  if (secretProviderInstance) {
    return secretProviderInstance;
  }

  // Check if new composite configuration is present
  const hasCompositeConfig = process.env.SECRET_READ_CHAIN || process.env.SECRET_WRITE_PROVIDER;
  
  if (hasCompositeConfig) {
    logger.info('Initializing composite secret provider system');
    secretProviderInstance = buildSecretProviders();
  } else {
    // Fall back to legacy single provider configuration
    const providerType = process.env.SECRET_PROVIDER_TYPE?.toLowerCase() || 'filesystem';
    logger.info(`Initializing secret provider (legacy mode). Type selected: ${providerType}`);

    switch (providerType) {
      case 'vault':
        secretProviderInstance = getProviderInstance('vault');
        break;
      case 'filesystem':
      default:
        if (providerType !== 'filesystem') {
          logger.warn(`Invalid SECRET_PROVIDER_TYPE '${process.env.SECRET_PROVIDER_TYPE}'. Defaulting to 'filesystem'.`);
        }
        secretProviderInstance = getProviderInstance('filesystem');
        break;
    }
  }

  // Ensure a provider instance was created
  if (!secretProviderInstance) {
    logger.error("Failed to initialize any secret provider!");
    throw new Error("Fatal: Could not initialize secret provider.");
  }

  return secretProviderInstance;
}

// Export the interface for type usage elsewhere using 'export type'
export type { ISecretProvider };

// Optional: Export a ready-to-use instance directly
// This simplifies usage in other modules: import { secrets } from '...'
// export const secrets = getSecretProviderInstance();
