import { isMspPrincipalUserType, type IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { checkMultiplePermissions } from './rbac';

/** Existing document grants remain sufficient. Scoped grants authorize only
 * their resource, never the general document library. One RBAC read preserves
 * the ordinary document permission-check query budget. */
async function knowledgeBaseGrants(user: IUser, connection?: Knex) {
  return checkMultiplePermissions(user, [
    { resource: 'document', action: 'read' },
    { resource: 'knowledge_base', action: 'read' },
  ], connection);
}

export async function canReadKnowledgeBase(user: IUser, connection?: Knex): Promise<boolean> {
  const permissions = await knowledgeBaseGrants(user, connection);
  return permissions[0].granted || (isMspPrincipalUserType(user.user_type) && permissions[1].granted);
}

/** Portal readers must still filter to published articles with a client/public
 * audience. A client scoped grant does not authorize the internal KB actions. */
export async function canReadPublishedKnowledgeBase(user: IUser, connection?: Knex): Promise<boolean> {
  return (await knowledgeBaseGrants(user, connection)).some(permission => permission.granted);
}
