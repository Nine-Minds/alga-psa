import type { ISecretProvider } from './ISecretProvider';

/**
 * Loads VaultSecretProvider only in Node.js runtime
 * This file should never be imported by Edge Runtime code
 */
export async function loadVaultSecretProvider(): Promise<ISecretProvider> {
  const { VaultSecretProvider } = await import('./VaultSecretProvider');
  return new VaultSecretProvider();
}
