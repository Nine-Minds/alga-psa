/**
 * Next.js dev hot reload re-evaluates the modules that register nodes and actions while the
 * registries they write to survive, so the same id is registered twice. In development a repeat
 * registration replaces the earlier definition, which also makes schema edits take effect without
 * a restart. Anywhere else a repeat registration is a bug and the registries throw.
 */
export const allowsRegistryReplacement = (): boolean => process.env.NODE_ENV === 'development';
