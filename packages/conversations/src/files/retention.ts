import type { Knex } from 'knex';

/** A producer (e.g. the editor) claims files it still references so cleanup spares them. */
export type ConversationFileRetentionHook = (trx: Knex.Transaction, tenant: string, fileIds: readonly string[]) => Promise<ReadonlySet<string>>;
const KEY = Symbol.for('alga-psa.conversations.fileRetention');
const hooks = (): Map<string, ConversationFileRetentionHook> => {
  const g = globalThis as unknown as Record<symbol, Map<string, ConversationFileRetentionHook> | undefined>;
  return (g[KEY] ??= new Map());
};
export const registerConversationFileRetention = (name: string, hook: ConversationFileRetentionHook): void => { hooks().set(name, hook); };
export const unregisterConversationFileRetention = (name: string): boolean => hooks().delete(name);
export async function claimedConversationFileIds(trx: Knex.Transaction, tenant: string, fileIds: readonly string[]): Promise<Set<string>> {
  const claimed = new Set<string>();
  if (fileIds.length === 0) return claimed;
  for (const hook of hooks().values()) for (const id of await hook(trx, tenant, fileIds)) claimed.add(id);
  return claimed;
}
