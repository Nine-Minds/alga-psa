import type { Knex } from 'knex';
import type { ConversationFileActor } from './types';

/** Domain authority for one kind of owning record. The engine asks; it never learns what
 * a ticket, project task or opportunity is. */
export interface ConversationFileOwnerAdapter {
  canRead(trx: Knex.Transaction, actor: ConversationFileActor, ownerId: string): Promise<boolean>;
  canWrite(trx: Knex.Transaction, actor: ConversationFileActor, ownerId: string): Promise<boolean>;
  /** Called by the owning domain when the record is deleted, so it can discard that owner's files. */
  onOwnerDeleted?(trx: Knex.Transaction, tenant: string, ownerId: string): Promise<void>;
}

export const OWNER_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const REGISTRY = Symbol.for('alga-psa.conversations.fileOwners');
type Registry = Map<string, ConversationFileOwnerAdapter>;
const registry = (): Registry => {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (g[REGISTRY] ??= new Map());
};

export function registerConversationFileOwner(ownerType: string, adapter: ConversationFileOwnerAdapter): void {
  if (!OWNER_TYPE_PATTERN.test(ownerType)) throw new Error('Invalid conversation file owner type');
  if (typeof adapter?.canRead !== 'function' || typeof adapter?.canWrite !== 'function') throw new Error('A conversation file owner needs canRead and canWrite');
  registry().set(ownerType, adapter);
}
export const unregisterConversationFileOwner = (ownerType: string): boolean => registry().delete(ownerType);
export const getConversationFileOwner = (ownerType: string): ConversationFileOwnerAdapter | undefined => registry().get(ownerType);
