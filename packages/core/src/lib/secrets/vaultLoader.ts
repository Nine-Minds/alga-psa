import type { ISecretProvider } from './ISecretProvider';

const runtimeImport = <TModule,>(specifier: string): Promise<TModule> => {
  const importer = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
  return importer<TModule>(specifier);
};

/**
 * Loads VaultSecretProvider only in Node.js runtime
 * This file should never be imported by Edge Runtime code
 */
export async function loadVaultSecretProvider(): Promise<ISecretProvider> {
  const { VaultSecretProvider } =
    await runtimeImport<typeof import('./VaultSecretProvider')>('./VaultSecretProvider');
  return new VaultSecretProvider();
}
