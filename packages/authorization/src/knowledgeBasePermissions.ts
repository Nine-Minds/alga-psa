import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { hasPermission } from './rbac';

type KnowledgeBaseReader = Pick<IUser, 'user_id' | 'user_type'> & { tenant?: string };

/**
 * The single "may this subject read the published knowledge base" predicate: `document:read` OR
 * `knowledge_base:read`. The portal KB actions and document authorization (`readable_via_published_parent`)
 * both call it, so the KB page and an article's embedded images can never disagree about who may read the KB.
 * It lives here, below `@alga-psa/auth`, because `shared` may not depend on `auth`.
 */
export async function canReadPublishedKnowledgeBase(
  user: KnowledgeBaseReader,
  connection?: Knex | Knex.Transaction
): Promise<boolean> {
  return (await hasPermission(user, 'document', 'read', connection))
    || (await hasPermission(user, 'knowledge_base', 'read', connection));
}
