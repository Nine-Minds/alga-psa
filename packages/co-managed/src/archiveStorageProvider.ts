/**
 * Deferred handle on the archive storage provider.
 *
 * `@alga-psa/storage` binds Node filesystem builtins (`fs`, `stream/promises`) at module scope via
 * LocalStorageProvider. Importing it statically from the archive modules puts that binding on the
 * conversation-event core path (conversationParticipationEvidence -> archiveFiles), which every
 * co-managed entry point transitively loads — including the ones a client component reaches through
 * a `'use server'` action module. Resolving the provider at call time keeps filesystem capability out
 * of the module graph until something actually moves bytes.
 */
export async function coManagedArchiveStorageProvider() {
  const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
  return StorageProviderFactory.createProvider();
}
