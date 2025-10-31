/// <reference types="node" />
import { ISecretProvider } from './ISecretProvider';
// Dynamic import Node-only providers to keep Edge runtime clean
import { EnvSecretProvider } from './EnvSecretProvider';
import { CompositeSecretProvider } from './CompositeSecretProvider';
import logger from './logger';

// Safe process.env access
const getEnvVar = (name: string): string | undefined => {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
};


let secretProviderInstance: ISecretProvider | null = null;

// Cached concrete provider instances for composite provider
let envProviderInstance: EnvSecretProvider | null = null;
let filesystemProviderInstance: any | null = null;
let vaultProviderInstance: ISecretProvider | null = null;

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
async function getProviderInstance(providerType: ProviderType): Promise<ISecretProvider> {
  switch (providerType) {
    case 'env':
      if (!envProviderInstance) {
        envProviderInstance = new EnvSecretProvider();
      }
      return envProviderInstance;

    case 'filesystem':
      if (!filesystemProviderInstance) {
        const { FileSystemSecretProvider } = await import('./FileSystemSecretProvider');
        filesystemProviderInstance = new FileSystemSecretProvider();
      }
      return filesystemProviderInstance;

    case 'vault':
      if (!vaultProviderInstance) {
        // Use direct vault provider
        try {
          const { loadVaultSecretProvider } = await import('./vaultLoader');
          vaultProviderInstance = await loadVaultSecretProvider();
          logger.info('Using VaultSecretProvider for Node runtime');
        } catch (error) {
          logger.error('Failed to load VaultSecretProvider:', error);
          throw new Error('VaultSecretProvider unavailable in current runtime');
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
  const readChainEnv = getEnvVar('SECRET_READ_CHAIN') || 'env';
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
      // Legacy mode: prefer filesystem for Node runtimes while retaining env-only support for Edge.
      const isNodeRuntime =
        typeof process !== 'undefined' && Boolean(process.versions?.node);
      const readChain: ProviderType[] = isNodeRuntime
        ? ['env', 'filesystem']
        : ['env'];
      const writeProviderType: ProviderType = isNodeRuntime ? 'filesystem' : 'env';

      logger.info(
        `Initializing secret provider (legacy mode with composite fallback). Using read chain [${readChain.join(
          ', '
        )}] with write provider ${writeProviderType}`
      );

      const readProviders = await Promise.all(
        readChain.map((provider) => getProviderInstance(provider))
      );
      const writeProvider = await getProviderInstance(writeProviderType);
      secretProviderInstance = new CompositeSecretProvider(readProviders, writeProvider);
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
