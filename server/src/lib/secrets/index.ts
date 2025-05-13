import { ISecretProvider } from './ISecretProvider.js';
import { FileSystemSecretProvider } from './FileSystemSecretProvider.js';
import { VaultSecretProvider } from './VaultSecretProvider.js';
import logger from 'server/src/utils/logger.js';

let secretProviderInstance: ISecretProvider | null = null;

/**
 * Factory function to get the configured secret provider instance.
 * Reads the `SECRET_PROVIDER_TYPE` environment variable to determine
 * which provider to instantiate ('filesystem' or 'vault').
 * Defaults to 'filesystem' if the variable is not set or invalid.
 *
 * @returns The singleton instance of the configured ISecretProvider.
 * @throws Error if the selected provider fails to initialize (e.g., missing Vault config).
 */
export function getSecretProviderInstance(): ISecretProvider {
  if (secretProviderInstance) {
    return secretProviderInstance;
  }

  const providerType = process.env.SECRET_PROVIDER_TYPE?.toLowerCase() || 'filesystem';

  logger.info(`Initializing secret provider. Type selected: ${providerType}`);

  switch (providerType) {
    case 'vault':
      secretProviderInstance = new VaultSecretProvider();
      // VaultSecretProvider constructor handles logging initialization errors.
      // We might want to check its internal `isInitialized` state if it had one,
      // but for now, we assume construction implies readiness or it logs errors.
      break;
    case 'filesystem':
    default:
      if (providerType !== 'filesystem') {
        logger.warn(`Invalid SECRET_PROVIDER_TYPE '${process.env.SECRET_PROVIDER_TYPE}'. Defaulting to 'filesystem'.`);
      }
      secretProviderInstance = new FileSystemSecretProvider();
      break;
  }

  // It's crucial that a provider instance is created.
  // If Vault provider failed initialization (logged internally), calls to it will return undefined.
  // If a future provider type might truly fail construction, we'd need more robust error handling here.
  if (!secretProviderInstance) {
     // This case should ideally not be reached with current providers unless
     // an unknown type was specified and default case somehow failed.
     logger.error("Failed to initialize any secret provider!");
     // Fallback to a minimal provider that always returns undefined? Or throw?
     // Throwing is safer to prevent unexpected behavior downstream.
     throw new Error("Fatal: Could not initialize secret provider.");
  }


  return secretProviderInstance;
}

// Export the interface for type usage elsewhere using 'export type'
export type { ISecretProvider };

// Optional: Export a ready-to-use instance directly
// This simplifies usage in other modules: import { secrets } from '...'
// export const secrets = getSecretProviderInstance();